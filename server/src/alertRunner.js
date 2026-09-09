/* Alert runner: for each enabled rule, read the latest snapshot at sim_now
 * matching its metric+window+dimension, compare, then open / update / resolve. */
const db = require('./db');
const gateways = require('./gateways');   // payment-gateway registry: rules scoped to a DISABLED gateway are paused

const OPS = {
  gt: (a, b) => a > b, gte: (a, b) => a >= b,
  lt: (a, b) => a < b, lte: (a, b) => a <= b,
  eq: (a, b) => a === b
};
const opLabel = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' };

function ksaHour(dateIso) {
  const d = new Date(dateIso);
  return (d.getUTCHours() + 3) % 24;
}
function activeNow(rule, simNow) {
  if (rule.active_from == null || rule.active_to == null) return true;
  const h = ksaHour(simNow);
  const f = rule.active_from, t = rule.active_to;
  return f <= t ? (h >= f && h < t) : (h >= f || h < t); // wraps midnight
}
// dim filter subset match
function dimMatch(snapDim, ruleDim) {
  const rd = ruleDim || {};
  return Object.keys(rd).every(k => String(snapDim[k]) === String(rd[k]));
}

function activeLabel(rule) {
  if (rule.active_from == null || rule.active_to == null) return null;
  return `KSA ${String(rule.active_from).padStart(2, '0')}:00–${String(rule.active_to).padStart(2, '0')}:00`;
}

// Read-only evaluation of every ENABLED rule at sim_now. No writes.
// Returns one row per rule with its current value / sample / fired flag + a human "counts" string.
async function evaluate(simNow) {
  const now = simNow instanceof Date ? simNow.toISOString() : simNow;
  const c = db.console;
  const rules = (await c.query(
    `SELECT r.*, COALESCE(mc.unit,'count') AS unit
     FROM alert_rules r LEFT JOIN metric_catalog mc ON mc.key = r.metric_key
     WHERE r.enabled = true
     ORDER BY CASE r.severity WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END, r.name`)).rows;
  const evals = [];
  for (const rule of rules) {
    const snaps = (await c.query(
      `SELECT dim, value, sample FROM metric_snapshots
       WHERE metric_key=$1 AND window_hours=$2 AND sim_now=$3`,
      [rule.metric_key, rule.window_hours, now])).rows;
    const snap = snaps.find(s => dimMatch(s.dim, rule.dim));
    const inWindow = activeNow(rule, now);
    const value = snap ? snap.value : null;
    const sample = snap ? snap.sample : null;
    const enoughSample = value != null && Number(sample) >= rule.min_sample;
    // a per-gateway rule (dim.gateway / dim.vendor) whose gateway is switched off in Settings → Payment gateways never
    // fires: a silent gateway is the expected state, not an outage. Its open alert resolves on this tick.
    let paused = null; try { paused = await gateways.pausedReason(rule); } catch (e) { paused = null; }
    const fired = !paused && !!(snap && inWindow && value != null && enoughSample && OPS[rule.operator](Number(value), Number(rule.threshold)));
    let counts;
    if (paused) counts = paused;
    else if (!inWindow) counts = `outside active window (${activeLabel(rule)})`;
    else if (!snap || value == null) counts = 'no data in window';
    else if (!enoughSample) counts = `observed ${fmt(value, rule)} (sample ${sample} < min ${rule.min_sample})`;
    else counts = `observed ${fmt(value, rule)} (sample ${sample}, ${rule.window_hours}h)`;
    evals.push({
      id: rule.id, key: rule.key, name: rule.name, severity: rule.severity, team: rule.team,
      metric_key: rule.metric_key, operator: rule.operator, threshold: Number(rule.threshold),
      min_sample: rule.min_sample, unit: rule.unit, window_hours: Number(rule.window_hours),
      active: activeLabel(rule), value, sample, fired, counts, segment: rule.segment || 'mvno', paused: !!paused
    });
  }
  return { now, evals };
}

async function runAlerts(simNow) {
  const now = simNow instanceof Date ? simNow.toISOString() : simNow;
  const c = db.console;
  const { evals } = await evaluate(simNow);
  const byKey = new Map(evals.map(e => [e.key, e]));
  // need the full rule rows for persistence details (rule_id, dim)
  const rules = (await c.query(`SELECT * FROM alert_rules WHERE enabled=true`)).rows;
  let opened = 0, resolved = 0, updated = 0;

  for (const rule of rules) {
    const ev = byKey.get(rule.key);
    if (!ev) continue;
    const openRow = (await c.query(
      `SELECT * FROM alerts WHERE rule_key=$1 AND status='open' ORDER BY id DESC LIMIT 1`,
      [rule.key])).rows[0];

    if (ev.fired) {
      const msg = `${rule.metric_key} ${opLabel[rule.operator]} ${rule.threshold} — observed ${fmt(ev.value, rule)} (n=${ev.sample}, ${rule.window_hours}h)`;
      if (openRow) {
        await c.query(
          `UPDATE alerts SET last_seen_at=$2, observed_value=$3, sample=$4,
             peak_value=GREATEST(peak_value,$3), breach_count=breach_count+1, message=$5
           WHERE id=$1`,
          [openRow.id, now, ev.value, ev.sample, msg]);
        updated++;
      } else if (await reopenRecent(c, rule, ev, now, msg)) {
        updated++;                                   // flap: same incident re-opened, no new page / mail
      } else {
        await c.query(
          `INSERT INTO alerts (rule_id, rule_key, name, severity, team, status, metric_key,
             operator, threshold, observed_value, sample, window_hours, dim, message,
             fired_at, last_seen_at, peak_value, breach_count, segment)
           VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$9,1,$15)`,
          [rule.id, rule.key, rule.name, rule.severity, rule.team, rule.metric_key,
           rule.operator, rule.threshold, ev.value, ev.sample, rule.window_hours,
           JSON.stringify(rule.dim || {}), msg, now, rule.segment || 'mvno']);
        opened++;
        ev.justOpened = true;
      }
    } else if (openRow) {
      // clear-hold: the condition must stay clear for `clearHoldMin` before the incident resolves
      const held = (new Date(now) - new Date(openRow.last_seen_at)) / 60000;
      if (held < flapCfg().clearHoldMin) continue;
      await c.query(`UPDATE alerts SET status='resolved', resolved_at=$2 WHERE id=$1`, [openRow.id, now]);
      resolved++;
    }
  }
  return { opened, resolved, updated, evals, simNow: now };
}

/* FLAP CONTROL (10 Sep 2026). Measured 5–9 Sep on Mobile: 872 incident rows in 4 days for 40 rules — the payment
 * failure storm alone re-opened 257 times because the metric oscillated around its threshold: every crossing was a
 * NEW incident (new mail, new page, new row to acknowledge). Two knobs, settings key 'alert_flap':
 *   reopenMin   (default 60): a rule that fires again within N min of its last incident RESOLVING re-opens THAT
 *               incident (ack / owner / discussion kept, breach_count++, reopen_count++) instead of opening a new one
 *   clearHoldMin (default 15): an open incident resolves only after the condition has been clear for N min
 * Both read at tick time, no restart needed. */
let _flap = null, _flapAt = 0;
function flapCfg() { return _flap || { reopenMin: 60, clearHoldMin: 15 }; }
async function loadFlap() {
  if (_flap && Date.now() - _flapAt < 60000) return _flap;
  try { const v = (await require('./settings').getSetting('alert_flap')) || {}; _flap = { reopenMin: Number(v.reopenMin) >= 0 ? Number(v.reopenMin) : 60, clearHoldMin: Number(v.clearHoldMin) >= 0 ? Number(v.clearHoldMin) : 15 }; }
  catch (_) { _flap = { reopenMin: 60, clearHoldMin: 15 }; }
  _flapAt = Date.now(); return _flap;
}
async function reopenRecent(c, rule, ev, now, msg) {
  const cfg = await loadFlap(); if (!cfg.reopenMin) return false;
  const prev = (await c.query(
    `SELECT id, ack_by FROM alerts WHERE rule_key=$1 AND status='resolved' AND resolved_at >= $2::timestamptz - ($3 || ' minutes')::interval ORDER BY id DESC LIMIT 1`,
    [rule.key, now, String(cfg.reopenMin)])).rows[0];
  if (!prev) return false;
  await c.query(
    `UPDATE alerts SET status='open', resolved_at=NULL, last_seen_at=$2, observed_value=$3, sample=$4,
       peak_value=GREATEST(coalesce(peak_value,0),$3), breach_count=breach_count+1, reopen_count=coalesce(reopen_count,0)+1, message=$5
     WHERE id=$1`, [prev.id, now, ev.value, ev.sample, msg]);
  await c.query(`INSERT INTO incident_comments (alert_id, author, body) VALUES ($1,'system',$2)`,
    [prev.id, `Re-opened: condition returned within ${cfg.reopenMin} min of resolving (flap) — same incident${prev.ack_by ? `, still owned by ${prev.ack_by}` : ''}`]).catch(() => {});
  return true;
}

function fmt(v, rule) {
  v = Number(v);
  return ['rate', 'ratio'].includes(rule.unit) ? (v * 100).toFixed(1) + '%' : (Number.isInteger(v) ? v : v.toFixed(2));
}

module.exports = { runAlerts, evaluate };
