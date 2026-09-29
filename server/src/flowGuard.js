/* flowGuard.js — Mobile › ONBOARDING FLOW GUARD (29 Sep 2026, tickets TKT-000068 / TKT-000069 by Sreekanth).
 *
 * WHAT. Orders placed through a flow the business never approved: a vanity number sold with a prepaid plan, an order
 * on a plan that was already disabled when it was placed, a number class that does not match the plan (a data-SIM
 * number on a voice plan or the reverse). None of these is an "error" anywhere — the web app accepts the order and
 * every API answers 200. They are SHAPES across three replica tables, read every 15 min:
 *
 *   numbers            the number chosen at checkout. group_id IS the class (3 Regular · 4 Silver · 5 Gold · 6 Platinum ·
 *                      7 Diamond · 11 Data SIM — the Apollo / BSS group ids); price_type is '1' on every row since 2022
 *                      and means nothing. One order holds SEVERAL rows (the numbers offered at checkout); the CHOSEN
 *                      one carries a reservation_id and an expires_at ≥ 30 days out (30 d Regular · 90 d Silver ·
 *                      120 d Gold/Platinum per the Apollo docs, though most vanity rows show 30 d).
 *   onboarding_orders  plan_id → plans.id, activated, created_at (the order time), checkout_id.
 *   plans              plan_type 1 = prepaid · 2 = postpaid (verified 29 Sep on the price list: postpaid carries the
 *                      VAT-inclusive prices), enabled, has_data_sim, sim_type, title.
 *
 * Measured 29 Sep 2026 (180 days, chosen numbers): Silver on postpaid 182 orders, Gold 39, Platinum 12; Silver on
 * prepaid 5 orders — NONE activated (the purchase step refuses them, number selection does not); Gold/Platinum on
 * prepaid 0. Orders on plans disabled TODAY: thousands (Super Flex 110 Plus 3,062 / 1,154 activated …) — but
 * `enabled` is only the current value: the Super Flex "Plus" series was live when those orders were placed and was
 * switched off in September; the Tamkeen / Freelancer / Visitor plans are hidden from the public catalog and sold
 * through their own eligibility flow, with orders every day. So "disabled plan" means DISABLED AT ORDER TIME, and the
 * plans sold through a dedicated flow are allow-listed (Console Settings › Flow guard).
 *
 * THE PLAN TIMELINE. `plan_state_history` (console DB) keeps every change of enabled / price / plan_type / name per
 * plan, taken from the replica on every tick. From now on "was the plan disabled when the order was placed" is exact;
 * for orders older than the first snapshot the answer is approximated with plans.updated_at (the evidence says so).
 *
 * PRIVACY. The console never stores a customer identifier for this feature: the finding carries the order id, the
 * checkout code, the number MASKED to its last three digits, the class and the plan. Customer 360 resolves the order.
 *
 * AGENTS. Agent 2 (incident triage) writes a deterministic verdict for these rules — no model needed, the cause is
 * the finding itself — and the incident opens on the Mobile digital L2 team (TCS) from the rule. Agent 1 (log
 * intelligence) carries the guard's 24 h picture in the daily report. Mission control shows the queue.
 *
 * PROD-SAFETY. One bounded query per tick on the replica (numbers.created_at window of a few days, joined by primary
 * keys), an 8 s one-off backfill of 180 days on the first run, no scans of activation ledgers.
 *
 * Env: FLOW_GUARD=0 disables · FLOW_GUARD_INTERVAL_MIN (15) · FLOW_GUARD_LOOKBACK_DAYS (7, the per-tick window) ·
 *      FLOW_GUARD_BACKFILL_DAYS (180, first run only) */
'use strict';
const db = require('./db');

const CFG = () => ({
  enabled: process.env.FLOW_GUARD !== '0',
  intervalMin: Math.max(5, Number(process.env.FLOW_GUARD_INTERVAL_MIN) || 15),
  lookbackDays: Math.max(1, Number(process.env.FLOW_GUARD_LOOKBACK_DAYS) || 7),
  backfillDays: Math.max(7, Number(process.env.FLOW_GUARD_BACKFILL_DAYS) || 180)
});

/* the number classes of the web channel = numbers.group_id = the Apollo vanity ids = the BSS msisdn groups (DMS uses
 * the same numbering: cms_logs.mobile_number_type_req). Prices are the Apollo catalog (SAR, VAT-exclusive). */
const CLASSES = {
  3: { key: 'regular', label: 'Regular', price: 0, vanity: false, color: '#64748b' },
  4: { key: 'silver', label: 'Silver', price: 500, vanity: true, color: '#839099' },
  5: { key: 'gold', label: 'Gold', price: 2500, vanity: true, color: '#d9a441' },
  6: { key: 'platinum', label: 'Platinum', price: 7000, vanity: true, color: '#334d5d' },
  7: { key: 'diamond', label: 'Diamond', price: null, vanity: true, color: '#7c3aed' },
  11: { key: 'datasim', label: 'Data SIM', price: 0, vanity: false, color: '#0891b2' }
};
const classOf = g => CLASSES[Number(g)] || { key: 'group' + g, label: 'Group ' + g, price: null, vanity: false, color: '#94a3b8' };
const isDataPlan = p => !!(p && (p.has_data_sim || /data\s*sim|\bmbb\b/i.test(String(p.name || ''))));

const KINDS = {
  vanity_prepaid: { label: 'Vanity number on a prepaid plan', short: 'Vanity · prepaid', severity: 'P3',
    why: 'Silver / Gold / Platinum / Diamond numbers are sold with postpaid plans only (the DMS dealer app enforces it in code: Free and IUC are the prepaid number types; every class is postpaid). On the web, number selection accepts the vanity, and the purchase step is what refuses it — 5 attempts in 180 days, none activated. An ACTIVATED one is a business-rule breach with the vanity price at stake.',
    action: 'Open the order in Customer 360 (checkout code) → confirm the class of the chosen number and the plan → raise with the Mobile digital L2 team (TCS): why did the purchase step accept a vanity with a prepaid plan? The customer keeps the number; the vanity fee and the plan type are for the business to settle.' },
  plan_disabled: { label: 'Order placed on a disabled plan', short: 'Disabled plan', severity: 'P3',
    why: 'The plan was already disabled (plans.enabled = false) when the order was placed — a stale app catalog, a deep link, or a cached plan list still selling it. Plans sold through a dedicated flow while hidden from the catalog (Tamkeen, Freelancer, Visitor …) are allow-listed and never counted; a plan switched off AFTER the order was placed is not counted either (the plan timeline decides).',
    action: 'Customer 360 → the order and its plan → check where it came from (platform / app version on the order) → Mobile digital L2 (TCS): the catalog the app served still carried the plan; the business decides whether to honour the order or move the customer to the live equivalent.' },
  class_mismatch: { label: 'Number class does not match the plan', short: 'Class ↔ plan', severity: 'P3',
    why: 'A Data SIM number (group 11) on a voice plan, or a voice number on a Data SIM / MBB plan. The number group and the plan family are assigned in two different steps of the checkout; when they disagree the activation creates a subscriber whose number range and rating profile do not belong together.',
    action: 'Customer 360 → the order, the chosen number and the plan → Mobile digital L2 (TCS) checks the activation in BSS (subscriber type vs number range) before the customer notices a service the plan does not cover.' }
};
/* plans sold through their own flow while hidden from the public catalog — default allow-list, editable in Settings */
const DEFAULT_ALLOW_PATTERNS = ['tamkeen', 'visitor', 'freelancer', 'martyr', 'fnf', 'tygo', 'hajj', 'simpal', 'pe '];
const DEFAULTS = { allow_plan_ids: [], allow_patterns: DEFAULT_ALLOW_PATTERNS, note: '' };

let running = false, lastRun = null, lastTiming = {};
const maskNum = s => { const d = String(s || '').replace(/\D/g, ''); return d ? '*'.repeat(Math.max(0, d.length - 3)) + d.slice(-3) : null; };

/* ---------------------------------------------------------------------------------------------- schema (console DB) */
let _ready = null;
function ensure() {
  if (_ready) return _ready;
  _ready = (async () => {
    await db.console.query(`CREATE TABLE IF NOT EXISTS flow_findings (
      id bigserial PRIMARY KEY, kind text NOT NULL, ukey text NOT NULL,
      order_id text, checkout_id text, number_masked text, group_id int, number_class text,
      plan_id text, plan_name text, plan_type int, plan_enabled boolean, disabled_since timestamptz, disabled_source text,
      amount numeric, activated boolean NOT NULL DEFAULT false, activated_at timestamptz, reservation_expires timestamptz,
      event_at timestamptz, detected_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
      evidence jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL DEFAULT 'open',
      inc text, note text, updated_by text, updated_at timestamptz, resolved_at timestamptz,
      UNIQUE (kind, ukey))`);
    await db.console.query(`CREATE INDEX IF NOT EXISTS idx_flow_findings_status ON flow_findings (status, detected_at DESC)`);
    await db.console.query(`CREATE INDEX IF NOT EXISTS idx_flow_findings_order ON flow_findings (order_id)`);
    await db.console.query(`CREATE TABLE IF NOT EXISTS flow_guard_runs (id bigserial PRIMARY KEY, at timestamptz DEFAULT now(), ms int, scanned int, found int, new_rows int, activated int, expired int, plan_changes int, backfill boolean DEFAULT false, errors jsonb)`);
    /* the plan timeline: one row per change (or first sight) of enabled / price / plan_type / name */
    await db.console.query(`CREATE TABLE IF NOT EXISTS plan_state_history (
      id bigserial PRIMARY KEY, plan_id text NOT NULL, ref text, name text, plan_type int, enabled boolean, price numeric,
      has_data_sim boolean, seen_at timestamptz NOT NULL DEFAULT now(), first boolean NOT NULL DEFAULT false, changed jsonb NOT NULL DEFAULT '{}'::jsonb)`);
    await db.console.query(`CREATE INDEX IF NOT EXISTS idx_plan_state_plan ON plan_state_history (plan_id, seen_at DESC)`);
  })().catch(e => { _ready = null; throw e; });
  return _ready;
}
async function getSettings() {
  try { const s = (await require('./settings').getSetting('flow_guard')) || {}; return { ...DEFAULTS, ...s, allow_plan_ids: Array.isArray(s.allow_plan_ids) ? s.allow_plan_ids.map(String) : [], allow_patterns: Array.isArray(s.allow_patterns) ? s.allow_patterns.map(x => String(x).toLowerCase().trim()).filter(Boolean) : DEFAULT_ALLOW_PATTERNS }; }
  catch (_) { return { ...DEFAULTS }; }
}
async function setSettings(patch, actor) {
  const settings = require('./settings'); const cur = await getSettings();
  const next = { ...cur, ...(patch || {}) };
  next.allow_plan_ids = (Array.isArray(next.allow_plan_ids) ? next.allow_plan_ids : []).map(String).filter(x => /^\d+$/.test(x));
  next.allow_patterns = (Array.isArray(next.allow_patterns) ? next.allow_patterns : String(next.allow_patterns || '').split(/[,\n]/)).map(x => String(x).toLowerCase().trim()).filter(Boolean).slice(0, 60);
  next.note = String(next.note || '').slice(0, 400); next.updated_by = actor || null; next.updated_at = new Date().toISOString();
  await settings.setSetting('flow_guard', next); return next;
}
const allowed = (p, s) => s.allow_plan_ids.includes(String(p.id)) || s.allow_patterns.some(pat => String(p.name || '').toLowerCase().includes(pat));

/* ---------------------------------------------------------------------------------------------- the plan timeline */
async function readPlans() {
  const r = await db.source.query(`SELECT id::text AS id, optiva_reference AS ref, plan_type, enabled, price, has_data_sim, sim_type, updated_at,
      coalesce(title->>'en', title->>'ar', '') AS name FROM plans ORDER BY id`);
  return r.rows;
}
async function snapshotPlans(plansRows) {
  const cur = (await db.console.query(`SELECT DISTINCT ON (plan_id) plan_id, enabled, price, plan_type, name FROM plan_state_history ORDER BY plan_id, seen_at DESC`)).rows;
  const byId = new Map(cur.map(r => [String(r.plan_id), r]));
  let changes = 0;
  for (const p of plansRows) {
    const prev = byId.get(String(p.id));
    const changed = {};
    if (!prev) changed.first = true;
    else {
      if (!!prev.enabled !== !!p.enabled) changed.enabled = [prev.enabled, p.enabled];
      if (Number(prev.price) !== Number(p.price)) changed.price = [Number(prev.price), Number(p.price)];
      if (Number(prev.plan_type) !== Number(p.plan_type)) changed.plan_type = [prev.plan_type, p.plan_type];
      if (String(prev.name || '') !== String(p.name || '')) changed.name = [prev.name, p.name];
    }
    if (!Object.keys(changed).length) continue;
    await db.console.query(`INSERT INTO plan_state_history (plan_id, ref, name, plan_type, enabled, price, has_data_sim, first, changed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [p.id, p.ref, p.name, p.plan_type, !!p.enabled, p.price, !!p.has_data_sim, !prev, JSON.stringify(changed)]);
    changes++;
  }
  return changes;
}
/* when did the plan become disabled — exact from the timeline (the latest enabled→false transition), else approximated
 * with plans.updated_at (a first snapshot that already found it disabled) */
async function disabledSinceMap() {
  const r = await db.console.query(`SELECT plan_id, seen_at FROM plan_state_history WHERE enabled = false AND NOT first AND changed ? 'enabled' ORDER BY plan_id, seen_at DESC`);
  const m = new Map();
  /* only OBSERVED switch-offs are exact; a plan first seen already disabled keeps plans.updated_at as its approximation */
  for (const x of r.rows) if (!m.has(String(x.plan_id))) m.set(String(x.plan_id), { at: new Date(x.seen_at), exact: true });
  /* a plan re-enabled after that transition is not disabled now — the caller checks plans.enabled first */
  return m;
}

/* ---------------------------------------------------------------------------------------------- detection */
const CHOSEN = `n.reservation_id IS NOT NULL AND n.expires_at - n.created_at > interval '1 day'`;
async function detect(days) {
  const t0 = Date.now();
  const plansRows = await readPlans();
  const planById = new Map(plansRows.map(p => [String(p.id), p]));
  const S = await getSettings();
  /* the timeline FIRST, so an order placed after a switch-off the console has just seen is judged exactly, not approximated */
  let planChanges = 0; try { planChanges = await snapshotPlans(plansRows); } catch (e) { lastTiming.plans_error = e.message; }
  const since = await disabledSinceMap();
  const r = await db.source.query(`
    SELECT o.id::text AS order_id, o.checkout_id::text AS checkout_id, o.plan_id::text AS plan_id, o.activated, o.created_at AS order_at,
           o.activated_platform AS platform, o.number_order_type, o.flow_type,
           n.identifier, n.group_id, n.reservation_id, n.expires_at, n.created_at AS number_at
      FROM numbers n JOIN onboarding_orders o ON o.id = n.onboarding_order_id
     WHERE n.created_at >= now() - ($1 || ' days')::interval AND ${CHOSEN}
       AND (n.group_id <> 3 OR o.plan_id::text = ANY($2::text[]))`,
    [String(days), plansRows.filter(p => !p.enabled || isDataPlan(p)).map(p => String(p.id))]);
  lastTiming.detect_ms = Date.now() - t0; lastTiming.scanned = r.rowCount;
  const found = [];
  for (const x of r.rows) {
    const p = planById.get(String(x.plan_id)); if (!p) continue;
    const cls = classOf(x.group_id);
    const base = { order_id: x.order_id, checkout_id: x.checkout_id, number_masked: maskNum(x.identifier), group_id: Number(x.group_id), number_class: cls.label,
      plan_id: String(p.id), plan_name: p.name, plan_type: Number(p.plan_type), plan_enabled: !!p.enabled, activated: !!x.activated,
      reservation_expires: x.expires_at, event_at: x.order_at,
      evidence: { platform: x.platform || null, flow_type: x.flow_type, port_in: Number(x.number_order_type) === 1, plan_ref: p.ref, plan_price: Number(p.price), reservation_id: String(x.reservation_id || ''), number_reserved_at: x.number_at, reservation_expires: x.expires_at } };
    /* 1 · vanity on prepaid */
    if (cls.vanity && Number(p.plan_type) === 1) found.push({ ...base, kind: 'vanity_prepaid', ukey: x.order_id + '|' + x.identifier, amount: cls.price, evidence: { ...base.evidence, vanity_price_sar: cls.price, rule: 'vanity classes are postpaid-only (DMS: prepaidNumberTypes = Free, IUC)' } });
    /* 2 · disabled at order time (never for allow-listed plans; never when the switch-off came after the order) */
    if (!p.enabled && !allowed(p, S)) {
      const d = since.get(String(p.id)) || (p.updated_at ? { at: new Date(p.updated_at), exact: false } : null);
      if (d && d.at <= new Date(x.order_at)) found.push({ ...base, kind: 'plan_disabled', ukey: x.order_id, amount: Number(p.price) || null, disabled_since: d.at, disabled_source: d.exact ? 'plan timeline' : 'plans.updated_at (approximation before the first snapshot)',
        evidence: { ...base.evidence, disabled_since: d.at.toISOString(), disabled_source: d.exact ? 'plan_state_history' : 'plans.updated_at', hours_after_disable: Math.round((new Date(x.order_at) - d.at) / 36e5) } });
    }
    /* 3 · class ↔ plan family */
    const dataPlan = isDataPlan(p);
    if ((Number(x.group_id) === 11 && !dataPlan) || (Number(x.group_id) !== 11 && dataPlan)) found.push({ ...base, kind: 'class_mismatch', ukey: x.order_id + '|' + x.identifier, amount: null, evidence: { ...base.evidence, mismatch: Number(x.group_id) === 11 ? 'data-SIM number on a voice plan' : 'voice number on a Data SIM / MBB plan', has_data_sim: !!p.has_data_sim } });
  }
  return { found, plansRows, planChanges };
}

/* ---------------------------------------------------------------------------------------------- the tick */
async function tick({ force } = {}) {
  if (running || !db.console || !db.source) return lastRun; running = true; const t0 = Date.now(); const C = CFG(); const errors = {};
  try {
    await ensure();
    const first = !(await db.console.query(`SELECT 1 FROM flow_guard_runs LIMIT 1`)).rowCount;
    const days = first ? C.backfillDays : C.lookbackDays;
    const { found, planChanges } = await detect(days);
    if (lastTiming.plans_error) { errors.plans = lastTiming.plans_error; delete lastTiming.plans_error; }
    let newRows = 0;
    for (const f of found) {
      /* a BACKFILLED row is dated by its order (detected_at / activated_at = event_at), so the first run never reads as
       * "hundreds activated in the last 24 h" to the rules — only what happens after the guard went live fires */
      const r = await db.console.query(`INSERT INTO flow_findings (kind, ukey, order_id, checkout_id, number_masked, group_id, number_class, plan_id, plan_name, plan_type, plan_enabled, disabled_since, disabled_source, amount, activated, activated_at, reservation_expires, event_at, evidence, status, detected_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,CASE WHEN $15 THEN (CASE WHEN $19 THEN $17::timestamptz ELSE now() END) END,$16,$17,$18, CASE WHEN $15 THEN 'activated' ELSE 'open' END, CASE WHEN $19 THEN $17::timestamptz ELSE now() END)
          ON CONFLICT (kind, ukey) DO UPDATE SET last_seen_at = now(), evidence = EXCLUDED.evidence, plan_enabled = EXCLUDED.plan_enabled,
            activated = EXCLUDED.activated, activated_at = CASE WHEN EXCLUDED.activated AND NOT flow_findings.activated THEN now() ELSE flow_findings.activated_at END,
            status = CASE WHEN flow_findings.status IN ('open','expired') AND EXCLUDED.activated THEN 'activated' ELSE flow_findings.status END,
            updated_at = CASE WHEN EXCLUDED.activated AND NOT flow_findings.activated THEN now() ELSE flow_findings.updated_at END
          RETURNING (xmax = 0) AS inserted`,
        [f.kind, f.ukey, f.order_id, f.checkout_id, f.number_masked, f.group_id, f.number_class, f.plan_id, f.plan_name, f.plan_type, f.plan_enabled, f.disabled_since || null, f.disabled_source || null, f.amount, f.activated, f.reservation_expires, f.event_at, JSON.stringify(f.evidence || {}), first]);
      if (r.rows[0] && r.rows[0].inserted) newRows++;
    }
    /* an open attempt whose reservation lapsed without activation carries no customer impact — closed as expired */
    const ex = await db.console.query(`UPDATE flow_findings SET status = 'expired', resolved_at = now(), updated_at = now(), updated_by = 'platform' WHERE status = 'open' AND NOT activated AND reservation_expires IS NOT NULL AND reservation_expires < now() - interval '1 day'`);
    const act = found.filter(f => f.activated).length;
    lastRun = { at: new Date().toISOString(), ms: Date.now() - t0, scanned: lastTiming.scanned || 0, found: found.length, new_rows: newRows, activated: act, expired: ex.rowCount, plan_changes: planChanges, backfill: first, days, errors };
    await db.console.query(`INSERT INTO flow_guard_runs (ms, scanned, found, new_rows, activated, expired, plan_changes, backfill, errors) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [lastRun.ms, lastRun.scanned, found.length, newRows, act, ex.rowCount, planChanges, first, JSON.stringify(errors)]).catch(() => {});
    await db.console.query(`DELETE FROM flow_guard_runs WHERE at < now() - interval '90 days'`).catch(() => {});
  } catch (e) { lastRun = { at: new Date().toISOString(), error: e.message, ms: Date.now() - t0 }; console.error('[flow-guard]', e.message); }
  finally { running = false; }
  return lastRun;
}
function start() {
  if (!CFG().enabled || !db.console || !db.source) return;
  const t = setTimeout(() => { tick(); setInterval(tick, CFG().intervalMin * 60e3); }, 55e3); if (t.unref) t.unref();
  console.log(`[flow-guard] armed — every ${CFG().intervalMin} min · window ${CFG().lookbackDays} d · backfill ${CFG().backfillDays} d on first run`);
}

/* ---------------------------------------------------------------------------------------------- reads */
async function overview() {
  await ensure();
  const [kinds, tiles, runs, changes, disabled, S] = await Promise.all([
    db.console.query(`SELECT kind, count(*) FILTER (WHERE status = 'open')::int AS open, count(*) FILTER (WHERE status = 'activated')::int AS activated,
        count(*) FILTER (WHERE status = 'activated' AND coalesce(activated_at, detected_at) >= now() - interval '24 hours')::int AS activated_24h,
        count(*) FILTER (WHERE detected_at >= now() - interval '24 hours')::int AS new_24h,
        count(*) FILTER (WHERE status = 'dismissed')::int AS dismissed, count(*) FILTER (WHERE status = 'expired')::int AS expired,
        count(*) FILTER (WHERE status = 'resolved')::int AS resolved,
        coalesce(sum(amount) FILTER (WHERE status = 'activated'), 0)::float AS activated_sar, max(event_at) AS last_event
      FROM flow_findings GROUP BY 1`),
    db.console.query(`SELECT count(*) FILTER (WHERE status = 'open')::int AS open, count(*) FILTER (WHERE status = 'activated')::int AS activated,
        count(*) FILTER (WHERE status = 'activated' AND inc IS NULL)::int AS activated_no_inc,
        count(*) FILTER (WHERE event_at >= now() - interval '7 days')::int AS orders_7d,
        count(*) FILTER (WHERE event_at >= now() - interval '30 days')::int AS orders_30d,
        coalesce(sum(amount) FILTER (WHERE status = 'activated' AND kind = 'vanity_prepaid'), 0)::float AS vanity_sar FROM flow_findings`),
    db.console.query(`SELECT at, ms, scanned, found, new_rows, activated, expired, plan_changes, backfill, errors FROM flow_guard_runs ORDER BY at DESC LIMIT 12`),
    db.console.query(`SELECT plan_id, ref, name, plan_type, enabled, price, seen_at, first, changed FROM plan_state_history WHERE NOT first ORDER BY seen_at DESC LIMIT 40`),
    db.console.query(`SELECT h.plan_id, h.name, h.plan_type, h.price, h.seen_at, h.first FROM plan_state_history h
        JOIN (SELECT plan_id, max(seen_at) AS m FROM plan_state_history GROUP BY plan_id) l ON l.plan_id = h.plan_id AND l.m = h.seen_at
        WHERE h.enabled = false ORDER BY h.seen_at DESC`),
    getSettings()
  ]);
  const K = {}; for (const k of Object.keys(KINDS)) K[k] = { ...KINDS[k], open: 0, activated: 0, activated_24h: 0, new_24h: 0, dismissed: 0, expired: 0, resolved: 0, activated_sar: 0, last_event: null };
  for (const r of kinds.rows) if (K[r.kind]) Object.assign(K[r.kind], r);
  const t = tiles.rows[0] || {};
  return { kinds: K, classes: CLASSES, tiles: t, runs: runs.rows, last_run: lastRun || (runs.rows[0] ? { at: runs.rows[0].at, ms: runs.rows[0].ms, found: runs.rows[0].found } : null), running,
    plan_changes: changes.rows, disabled_plans: disabled.rows.map(p => ({ ...p, allowed: allowed({ id: p.plan_id, name: p.name }, S) })), settings: S, cfg: CFG(),
    history_since: (await db.console.query(`SELECT min(seen_at) AS m FROM plan_state_history`)).rows[0].m || null };
}
async function list({ status, kind, q, days, limit } = {}) {
  await ensure();
  const w = [], par = [];
  if (status && status !== 'all') { par.push(status); w.push(`status = $${par.length}`); }
  if (kind && KINDS[kind]) { par.push(kind); w.push(`kind = $${par.length}`); }
  if (days) { par.push(String(Math.min(Number(days) || 30, 400))); w.push(`event_at >= now() - ($${par.length} || ' days')::interval`); }
  if (q) { par.push('%' + String(q).trim() + '%'); par.push(String(q).replace(/\D/g, '').slice(-3)); w.push(`(order_id ILIKE $${par.length - 1} OR checkout_id ILIKE $${par.length - 1} OR plan_name ILIKE $${par.length - 1} OR inc ILIKE $${par.length - 1} OR ($${par.length} <> '' AND right(number_masked, 3) = $${par.length}))`); }
  par.push(Math.min(Number(limit) || 400, 2000));
  const r = await db.console.query(`SELECT * FROM flow_findings ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY (status = 'activated') DESC, (status = 'open') DESC, event_at DESC LIMIT $${par.length}`, par);
  return r.rows;
}
async function setStatus(id, { status, inc, note }, actor) {
  await ensure();
  if (!['dismissed', 'resolved', 'open'].includes(status)) throw new Error('status must be dismissed | resolved | open');
  const r = await db.console.query(`UPDATE flow_findings SET status = $2, inc = coalesce(nullif($3,''), inc), note = coalesce(nullif($4,''), note), updated_by = $5, updated_at = now(),
      resolved_at = CASE WHEN $2 IN ('dismissed','resolved') THEN now() ELSE NULL END WHERE id = $1 RETURNING *`, [id, status, inc || null, note || null, actor || null]);
  if (!r.rowCount) throw new Error('finding not found');
  return r.rows[0];
}
/* Customer 360: the chosen number's class and the guard's verdict for one order (identity card) */
async function forOrder(orderId) {
  if (!orderId || !db.source) return null;
  try {
    const n = await db.source.query(`SELECT identifier, group_id, expires_at, reservation_id FROM numbers WHERE onboarding_order_id = $1::uuid AND ${'reservation_id IS NOT NULL AND expires_at - created_at > interval \'1 day\''} ORDER BY created_at DESC LIMIT 1`, [String(orderId)]).catch(() => ({ rows: [] }));
    const row = n.rows[0]; if (!row) return null;
    const cls = classOf(row.group_id);
    let findings = [];
    try { await ensure(); findings = (await db.console.query(`SELECT id, kind, status, inc, amount, event_at FROM flow_findings WHERE order_id = $1 ORDER BY event_at DESC LIMIT 6`, [String(orderId)])).rows.map(f => ({ ...f, label: (KINDS[f.kind] || {}).short || f.kind })); } catch (_) {}
    return { order_id: String(orderId), number: row.identifier, group_id: Number(row.group_id), class: cls.label, class_key: cls.key, color: cls.color, vanity: cls.vanity, price_sar: cls.price, reserved_until: row.expires_at, findings };
  } catch (_) { return null; }
}
/* the plan catalog with its live state and the timeline (Settings panel + Yusr) */
async function planCatalog() {
  await ensure();
  const [plans, hist] = await Promise.all([readPlans().catch(() => []), db.console.query(`SELECT plan_id, seen_at, enabled, price, plan_type, name, first, changed FROM plan_state_history ORDER BY seen_at DESC LIMIT 600`)]);
  const S = await getSettings();
  const byPlan = {}; for (const h of hist.rows) (byPlan[String(h.plan_id)] = byPlan[String(h.plan_id)] || []).push(h);
  const orders = (await db.console.query(`SELECT plan_id, count(*)::int AS findings, count(*) FILTER (WHERE status = 'activated')::int AS activated FROM flow_findings GROUP BY 1`)).rows;
  const oBy = new Map(orders.map(o => [String(o.plan_id), o]));
  return plans.map(p => ({ ...p, data_plan: isDataPlan(p), allowed: allowed(p, S), history: (byPlan[String(p.id)] || []).slice(0, 12), findings: (oBy.get(String(p.id)) || {}).findings || 0, findings_activated: (oBy.get(String(p.id)) || {}).activated || 0 }));
}

/* ---------------------------------------------------------------------------------------------- agents */
/* Agent 2 — a deterministic verdict for the guard's rules: the cause IS the finding; no model call. */
async function triageFor(alert) {
  await ensure();
  const kind = /vanity/.test(alert.rule_key || '') ? 'vanity_prepaid' : /disabled/.test(alert.rule_key || '') ? 'plan_disabled' : 'class_mismatch';
  const K = KINDS[kind];
  const rows = (await db.console.query(`SELECT order_id, checkout_id, number_masked, number_class, plan_name, plan_type, amount, status, event_at, inc FROM flow_findings WHERE kind = $1 AND status IN ('activated','open') ORDER BY (status = 'activated') DESC, event_at DESC LIMIT 5`, [kind])).rows;
  const act = rows.filter(r => r.status === 'activated');
  const sample = (act[0] || rows[0]);
  const sar = act.reduce((a, r) => a + Number(r.amount || 0), 0);
  return {
    probable_cause: `${K.label}: ${act.length ? act.length + ' activated order(s)' : rows.length + ' attempt(s), none activated'}${sample ? ` — e.g. checkout ${sample.checkout_id || sample.order_id} · ${sample.number_class} number · plan ${sample.plan_name} (${Number(sample.plan_type) === 2 ? 'postpaid' : 'prepaid'})` : ''}. ${K.why.split('.')[0]}.`,
    impact: act.length ? `${act.length} customer(s) activated through a non-approved flow${sar ? ` · ${sar.toFixed(0)} SAR of vanity fees at stake` : ''}` : 'no customer activated yet — attempts only, the purchase step held',
    suggested_team: 'mobile-digital-l2', suggested_action: K.action, priority_hint: act.length ? 'P3' : 'P4', confidence: 0.95, is_noise: false, deterministic: true,
    cases: rows.map(r => ({ checkout: r.checkout_id, order: r.order_id, number: r.number_masked, cls: r.number_class, plan: r.plan_name, status: r.status, inc: r.inc }))
  };
}
/* Agent 1 — the 24 h picture for the daily report */
async function dailySummary() {
  try { await ensure();
    const r = await db.console.query(`SELECT kind, count(*) FILTER (WHERE detected_at >= now() - interval '24 hours')::int AS new_24h, count(*) FILTER (WHERE status = 'activated' AND coalesce(activated_at, detected_at) >= now() - interval '24 hours')::int AS activated_24h,
        count(*) FILTER (WHERE status = 'open')::int AS open, count(*) FILTER (WHERE status = 'activated' AND inc IS NULL)::int AS activated_no_inc FROM flow_findings GROUP BY 1`);
    const ch = (await db.console.query(`SELECT count(*)::int n FROM plan_state_history WHERE NOT first AND seen_at >= now() - interval '24 hours'`)).rows[0].n;
    return { kinds: r.rows.map(x => ({ ...x, label: (KINDS[x.kind] || {}).short || x.kind })), plan_changes_24h: ch };
  } catch (e) { return { error: e.message, kinds: [], plan_changes_24h: 0 }; }
}
/* Mission control — the queue line */
async function queue() {
  try { await ensure(); return (await db.console.query(`SELECT count(*) FILTER (WHERE status = 'open')::int AS open, count(*) FILTER (WHERE status = 'activated' AND inc IS NULL)::int AS activated_no_inc, count(*) FILTER (WHERE status = 'activated')::int AS activated FROM flow_findings`)).rows[0]; }
  catch (_) { return { open: 0, activated_no_inc: 0, activated: 0 }; }
}

/* ---------------------------------------------------------------------------------------------- metrics (metrics.js) */
/* value = ACTIVATED findings of the kind whose activation was seen in the window; sample = every finding (attempts included) */
async function metric(kind, now, w, { attempts } = {}) {
  await ensure();
  const r = await db.console.query(`SELECT count(*)::int AS all_rows, count(*) FILTER (WHERE activated)::int AS activated
      FROM flow_findings WHERE kind = $3 AND status <> 'dismissed' AND coalesce(activated_at, detected_at) >= $1::timestamptz - ($2||' hours')::interval AND coalesce(activated_at, detected_at) < $1::timestamptz`, [now, w, kind]);
  const x = r.rows[0] || { all_rows: 0, activated: 0 };
  return [{ dim: {}, value: attempts ? Number(x.all_rows) : Number(x.activated), sample: Number(x.all_rows) }];
}

/* ---------------------------------------------------------------------------------------------- routes */
function mount(app, { requireView, requireCap, audit }) {
  const gate = requireView('errors');
  const manage = requireCap ? requireCap('manageSync') : (req, res, next) => next();
  const act = requireCap ? requireCap('ackErrors') : (req, res, next) => next();
  app.get('/api/flowguard/overview', gate, async (req, res) => { try { res.json(await overview()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/api/flowguard/findings', gate, async (req, res) => { try { res.json({ rows: await list(req.query) }); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/api/flowguard/plans', gate, async (req, res) => { try { res.json({ plans: await planCatalog() }); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/api/flowguard/:id/status', act, async (req, res) => { try {
    const row = await setStatus(Number(req.params.id), req.body || {}, req.sessionEmail);
    if (audit) audit(req, 'flowguard.status', String(row.id), { status: row.status, inc: row.inc || null, kind: row.kind, order: row.order_id });
    res.json(row); } catch (e) { res.status(400).json({ error: e.message }); } });
  app.post('/api/flowguard/run', manage, async (req, res) => { try { res.json(await tick({ force: true })); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/api/flowguard/settings', gate, async (req, res) => { try { res.json(await getSettings()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/api/flowguard/settings', manage, async (req, res) => { try {
    const s = await setSettings(req.body || {}, req.sessionEmail);
    if (audit) audit(req, 'flowguard.settings', 'flow_guard', { allow_plan_ids: s.allow_plan_ids, allow_patterns: s.allow_patterns });
    res.json(s); } catch (e) { res.status(400).json({ error: e.message }); } });
}

module.exports = { mount, start, tick, overview, list, setStatus, forOrder, planCatalog, triageFor, dailySummary, queue, metric, KINDS, CLASSES, classOf, ensure, getSettings };
