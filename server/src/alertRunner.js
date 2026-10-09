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
      `SELECT dim, value, sample, customers, customers_total, services, services_total FROM metric_snapshots
       WHERE metric_key=$1 AND window_hours=$2 AND sim_now=$3`,
      [rule.metric_key, rule.window_hours, now])).rows;
    const snap = snaps.find(s => dimMatch(s.dim, rule.dim));
    const inWindow = activeNow(rule, now);
    /* IMPACT COUNTING (11 Sep 2026, identity.js). count_by = events (classic) | customers | services:
     * the rule's value becomes the DISTINCT count (or, for a rate, counted ÷ population on that key) and
     * the sample becomes the distinct population. `customers` = distinct customers hit — always reported,
     * whatever the rule counts, and used by the min_customers floor below. */
    const cb = rule.count_by || 'events';
    const isRate = ['rate', 'ratio'].includes(rule.unit);
    let value = snap ? snap.value : null;
    let sample = snap ? snap.sample : null;
    let identityMissing = false;
    if (snap && cb !== 'events') {
      const n = cb === 'customers' ? snap.customers : snap.services;
      const tot = cb === 'customers' ? snap.customers_total : snap.services_total;
      if (n == null) { identityMissing = true; value = null; }
      else { value = isRate ? (Number(tot) > 0 ? Number(n) / Number(tot) : null) : Number(n); sample = Number(tot); }
    }
    const eventsValue = snap ? snap.value : null, eventsSample = snap ? snap.sample : null;
    const counted = snap && eventsValue != null ? (isRate ? Math.round(Number(eventsValue) * Number(eventsSample || 0)) : Number(eventsValue)) : null;
    const customers = snap && snap.customers != null ? Number(snap.customers) : null;
    const services = snap && snap.services != null ? Number(snap.services) : null;
    const enoughSample = value != null && Number(sample) >= rule.min_sample;
    // a per-gateway rule (dim.gateway / dim.vendor) whose gateway is switched off in Settings → Payment gateways never
    // fires: a silent gateway is the expected state, not an outage. Its open alert resolves on this tick.
    let paused = null; try { paused = await gateways.pausedReason(rule); } catch (e) { paused = null; }
    let fired = !paused && !!(snap && inWindow && value != null && enoughSample && OPS[rule.operator](Number(value), Number(rule.threshold)));
    /* SHADOW custom metrics (customMetrics.js): evaluated like any other, but never page — the operator sees what
     * WOULD have fired on the Metrics tab (would_fire) before letting the definition go live. */
    let shadowFired = false;
    try { if (fired && await require('./customMetrics').isShadow(rule.metric_key)) { shadowFired = true; fired = false; require('./customMetrics').noteWouldFire(rule.metric_key); } } catch (_) {}
    /* single-customer floor: the condition is met but fewer than min_customers distinct customers are behind it →
     * it fires at single_customer_severity (P4 by default): a retry storm is not an outage. Severity goes back up
     * on a later tick when more customers appear (runAlerts updates the open incident). */
    const minC = Number(rule.min_customers || 0);
    let severity = rule.severity, downgraded = false;
    if (fired && minC > 0 && customers != null && customers < minC) { severity = rule.single_customer_severity || 'P4'; downgraded = true; }
    /* a metric may name WHAT it found in dim.note (e.g. the worst app-log signature) — carried into the incident text */
    const note = snap && snap.dim && typeof snap.dim.note === 'string' && snap.dim.note ? ` · ${snap.dim.note.slice(0, /^hosts: /.test(snap.dim.note) ? 600 : 220)}` : '';
    const who = customers != null ? ` · ${customers} customer${customers === 1 ? '' : 's'}${counted != null && cb === 'events' && customers > 0 && counted > customers ? ` (${counted} attempts)` : ''}` : '';
    let counts;
    if (paused) counts = paused;
    else if (!inWindow) counts = `outside active window (${activeLabel(rule)})`;
    else if (identityMissing) counts = `no identity counts yet for this window (first sync after the rule change computes them)`;
    else if (!snap || value == null) counts = 'no data in window';
    else if (!enoughSample) counts = `observed ${fmt(value, rule)} (sample ${sample} < min ${rule.min_sample})${who}`;
    else counts = `observed ${fmt(value, rule)} (${cb === 'events' ? 'sample' : cb === 'customers' ? 'customers' : 'services'} ${sample}, ${rule.window_hours}h)${who}${downgraded ? ` → ${severity} (below ${minC} customers)` : ''}${shadowFired ? ' · SHADOW — would have fired, not paged' : ''}`;
    evals.push({ note,
      id: rule.id, key: rule.key, name: rule.name, severity, rule_severity: rule.severity, downgraded, team: rule.team,
      metric_key: rule.metric_key, operator: rule.operator, threshold: Number(rule.threshold),
      min_sample: rule.min_sample, unit: rule.unit, window_hours: Number(rule.window_hours), count_by: cb, min_customers: minC,
      active: activeLabel(rule), value, sample, customers, services, counted, fired, shadowFired, counts, segment: rule.segment || 'mvno', paused: !!paused
    });
  }
  return { now, evals };
}

/* ── TWIN COLLAPSE (18 Sep 2026) ───────────────────────────────────────────────────────────────
 * seedRules generates most rules as a P1/P2 pair on the SAME metric + window + dim: "technical
 * error rate (P2)" beside "technical error storm (P1)", money-at-risk >=1 beside >=5, step latency
 * 5 s beside 10 s. Thirty such pairs on Fixed alone, and both conditions are true at once by
 * construction — so one event opened two incidents, sent two mails and needed two acknowledgements.
 * The seeded runbooks already promise "downgrades to the P2 twin as it recovers"; nothing
 * implemented it.
 *
 * Now every group of rules sharing (metric_key, window_hours, dim) owns ONE incident, carried by
 * the LEAST severe rule in the group — the threshold that is crossed first and released last, so it
 * spans the whole event. Severity and name follow the most severe rule currently breached and move
 * back down as it recovers. A severity rise is recorded on the incident and the higher severity's
 * escalation ladder applies from the next tick; esc_level is deliberately left alone (see the note at
 * the severity-change branch). Rules in a group all read the same snapshot, so value and sample are
 * identical across it. */
const SEV_RANK = { P1: 1, P2: 2, P3: 3, P4: 4 };
const rank = sev => SEV_RANK[sev] || 4;
const stableDim = d => { const o = d || {}; return JSON.stringify(Object.keys(o).sort().reduce((a, k) => (a[k] = o[k], a), {})); };
const groupKeyOf = r => `${r.metric_key}|${Number(r.window_hours)}|${stableDim(r.dim)}`;
/* rule.key -> { anchor, members } for every enabled rule */
function groupRules(rules) {
  const groups = new Map();
  for (const r of rules) { const g = groupKeyOf(r); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
  const of = new Map();
  for (const members of groups.values()) {
    const anchor = members.slice().sort((a, b) => rank(b.severity) - rank(a.severity) || String(a.key).localeCompare(String(b.key)))[0];
    for (const m of members) of.set(m.key, { anchor, members });
  }
  return of;
}

async function runAlerts(simNow) {
  const now = simNow instanceof Date ? simNow.toISOString() : simNow;
  const c = db.console;
  const { evals } = await evaluate(simNow);
  const byKey = new Map(evals.map(e => [e.key, e]));
  /* RESOLVE + HOLD (20 Sep 2026) — retire every hold that has run out BEFORE the rules are read, so a
   * non-null held_until below always means a hold that is still running and the rules table stays clean.
   * Holds are wall-clock, never sim_now: a person asked for quiet until a real time of day, and in replay
   * mode sim_now is a virtual clock walking over a static dump. */
  try {
    /* RETURNING on an UPDATE hands back the row AFTER the write, so `RETURNING held_alert_id` on the
     * clearing UPDATE is always NULL and the incident never gets its comment. Read the expiring rows in
     * a CTE and RETURN from that side, which still holds the pre-update values, in one statement. */
    const done = (await c.query(
      `WITH expiring AS (
         SELECT key, held_alert_id FROM alert_rules WHERE held_until IS NOT NULL AND held_until <= now()
       )
       UPDATE alert_rules r SET held_until=NULL, held_by=NULL, held_reason=NULL, held_alert_id=NULL
         FROM expiring e WHERE r.key = e.key
       RETURNING e.key AS key, e.held_alert_id AS held_alert_id`)).rows;
    for (const d of done) {
      if (!d.held_alert_id) continue;
      await c.query(`INSERT INTO incident_comments (alert_id, author, body) VALUES ($1,'system',$2)`,
        [d.held_alert_id, `Hold expired — ${d.key} is being evaluated again. If the condition is still breaching, the next tick opens a NEW incident.`]).catch(() => {});
    }
  } catch (e) { console.error('[ALERTS] hold sweep:', e.message); }
  /* RULE SWITCHED OFF (9 Oct 2026, alpha.163): this loop only walks the enabled rules, so an incident left open by a rule
   * that was disabled in the console or retired by init.js stayed open for ever (fixed_applog_volume_collapse_sda, retired
   * in alpha.162, fired once more during the deploy). Nothing watches that signal any more — close it and say why. */
  try {
    const off = (await c.query(
      `UPDATE alerts a SET status='resolved', resolved_at=$1, resolve_reason='rule_disabled', resolved_by=COALESCE(a.resolved_by,'system')
         FROM alert_rules r WHERE r.key = a.rule_key AND r.enabled = false AND a.status = 'open' RETURNING a.id, a.rule_key`, [now])).rows;
    for (const x of off) await c.query(`INSERT INTO incident_comments (alert_id, author, body) VALUES ($1,'system',$2)`,
      [x.id, `Closed: the rule ${x.rule_key} is switched off — nothing watches this signal any more. Switch the rule back on in Alert rules to watch it again.`]).catch(() => {});
    if (off.length) console.log(`[ALERTS] closed ${off.length} incident(s) of switched-off rules: ${off.map(x => x.rule_key).join(', ')}`);
  } catch (e) { console.error('[ALERTS] switched-off sweep:', e.message); }
  // need the full rule rows for persistence details (rule_id, dim)
  const rules = (await c.query(`SELECT * FROM alert_rules WHERE enabled=true`)).rows;
  const grouped = groupRules(rules);
  let opened = 0, resolved = 0, updated = 0, collapsed = 0, held = 0;
  const heldKeys = [];

  for (const rule of rules) {
    const ev = byKey.get(rule.key);
    if (!ev) continue;
    const { anchor, members } = grouped.get(rule.key) || { anchor: rule, members: [rule] };

    /* a twin never carries its own incident. Anything left open under one from before this change
     * is closed as a duplicate on the first tick, so the pair collapses without manual cleanup. */
    if (anchor.key !== rule.key) {
      const stale = (await c.query(`SELECT id FROM alerts WHERE rule_key=$1 AND status='open'`, [rule.key])).rows;
      for (const st of stale) {
        await c.query(`UPDATE alerts SET status='resolved', resolved_at=$2, resolve_reason='duplicate', resolved_by=COALESCE(resolved_by,'system') WHERE id=$1`, [st.id, now]);
        await c.query(`INSERT INTO incident_comments (alert_id, author, body) VALUES ($1,'system',$2)`,
          [st.id, `Closed as duplicate: this rule watches the same signal as ${anchor.key} (${rule.metric_key}, ${rule.window_hours}h, ${stableDim(rule.dim)}), which now carries one incident for the whole pair and follows its severity.`]).catch(() => {});
        resolved++; collapsed++;
      }
      continue;
    }

    /* the group's state: the most severe member currently breached decides severity and wording */
    const firedEv = members.map(m => byKey.get(m.key)).filter(e => e && e.fired).sort((a, b) => rank(a.severity) - rank(b.severity));
    const sig = firedEv[0] || ev;                       // same snapshot across the group
    const sigRule = firedEv[0] ? (members.find(m => m.key === firedEv[0].key) || rule) : rule;
    const groupFired = firedEv.length > 0;

    const openRow = (await c.query(
      `SELECT * FROM alerts WHERE rule_key=$1 AND status='open' ORDER BY id DESC LIMIT 1`,
      [rule.key])).rows[0];

    if (groupFired) {
      const who = sig.customers != null ? ` · ${sig.customers} customer${sig.customers === 1 ? '' : 's'}${sig.counted != null && sig.count_by === 'events' && sig.counted > sig.customers ? `, ${sig.counted} attempts` : ''}` : '';
      let asOf = ''; try { asOf = await dataAsOf(rule); } catch (_) {}
      const msg = `${rule.metric_key} ${opLabel[sigRule.operator]} ${sigRule.threshold} — observed ${fmt(sig.value, rule)} (n=${sig.sample}, ${rule.window_hours}h)${who}${sig.note || ''}${asOf ? ` · ${asOf}` : ''}`;
      if (openRow) {
        await c.query(
          `UPDATE alerts SET last_seen_at=$2, observed_value=$3, sample=$4,
             peak_value=GREATEST(peak_value,$3), breach_count=breach_count+1, message=$5,
             severity=$6, rule_severity=$7, customers=COALESCE($8, customers), services=COALESCE($9, services),
             name=$10, threshold=$11, operator=$12
           WHERE id=$1`,
          [openRow.id, now, sig.value, sig.sample, msg, sig.severity, sig.downgraded ? sig.rule_severity : null, sig.customers, sig.services,
           sigRule.name, sigRule.threshold, sigRule.operator]);
        if (openRow.severity !== sig.severity) {
          /* the severity moved: either a twin threshold was crossed / released, or the customer floor
           * applied. A RISE restarts the paging ladder at the new severity. */
          const rose = rank(sig.severity) < rank(openRow.severity);
          /* Do NOT reset esc_level here. escalation.js computes the due tier from elapsed time since
           * opened_wall and then pages every tier from esc_level up to it, so zeroing esc_level on an
           * hours-old unacknowledged incident makes it page L1, L2 and L3 in the same pass. Leaving it
           * alone gives the right behaviour on its own: the new severity's ladder is consulted from the
           * next tick, and if it is faster or longer than the old one the next due tier pages normally. */
          /* A twin group always explains itself by which threshold is breached. The customer floor only
           * owns the wording when it actually applied, or when the rule has no twin to explain it. */
          const why = sig.downgraded
            ? `only ${sig.customers} customer(s) affected — below the rule's ${sig.min_customers}-customer floor`
            : members.length > 1
            ? `${sigRule.name} (${opLabel[sigRule.operator]} ${sigRule.threshold}) is ${rose ? 'now breached' : 'the highest threshold still breached'}`
            : sig.customers != null ? `${sig.customers} customer(s) affected — rule severity restored`
            : 'rule severity restored';
          await c.query(`INSERT INTO incident_comments (alert_id, author, body) VALUES ($1,'system',$2)`,
            [openRow.id, `Severity ${openRow.severity} → ${sig.severity}: ${why}${rose ? ' — the higher severity\u2019s escalation ladder now applies.' : '.'}`]).catch(() => {});
        }
        updated++;
      } else if (holdActive(rule)) {
        /* a person resolved this rule and asked to stay quiet while the rolling window drains. The
         * condition is still true — that is expected and is exactly what they acknowledged — so we
         * neither re-open the incident they closed nor open a new one. The hold sweep above lets it
         * back in the moment held_until passes. */
        held++; heldKeys.push(rule.key);
      } else if (await reopenRecent(c, rule, sig, now, msg)) {
        updated++;                                   // flap: same incident re-opened, no new page / mail
      } else {
        await c.query(
          `INSERT INTO alerts (rule_id, rule_key, name, severity, team, status, metric_key,
             operator, threshold, observed_value, sample, window_hours, dim, message,
             fired_at, last_seen_at, peak_value, breach_count, segment, rule_severity, customers, services)
           VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$9,1,$15,$16,$17,$18)`,
          [rule.id, rule.key, sigRule.name, sig.severity, rule.team, rule.metric_key,
           sigRule.operator, sigRule.threshold, sig.value, sig.sample, rule.window_hours,
           JSON.stringify(rule.dim || {}), msg, now, rule.segment || 'mvno', sig.downgraded ? sigRule.severity : null, sig.customers, sig.services]);
        opened++;
        ev.justOpened = true;
      }
    } else if (openRow) {
      // clear-hold: the condition must stay clear for `clearHoldMin` before the incident resolves
      const held = (new Date(now) - new Date(openRow.last_seen_at)) / 60000;
      if (held < flapCfg().clearHoldMin) continue;
      await c.query(`UPDATE alerts SET status='resolved', resolved_at=$2, resolve_reason=COALESCE(resolve_reason,'cleared'), resolved_by=COALESCE(resolved_by,'system') WHERE id=$1`, [openRow.id, now]);
      resolved++;
    }
  }
  if (held) console.log(`[ALERTS] ${held} rule(s) still breaching but held by an operator resolve: ${heldKeys.join(', ')}`);
  return { opened, resolved, updated, collapsed, held, heldKeys, evals, simNow: now };
}

/* FLAP CONTROL (10 Sep 2026). Measured 5–9 Sep on Mobile: 872 incident rows in 4 days for 40 rules — the payment
 * failure storm alone re-opened 257 times because the metric oscillated around its threshold: every crossing was a
 * NEW incident (new mail, new page, new row to acknowledge). Two knobs, settings key 'alert_flap':
 *   reopenMin   (default 60): a rule that fires again within N min of its last incident RESOLVING re-opens THAT
 *               incident (ack / owner / discussion kept, breach_count++, reopen_count++) instead of opening a new one
 *   clearHoldMin (default 15): an open incident resolves only after the condition has been clear for N min
 * Both read at tick time, no restart needed.
 * NOTE (20 Sep 2026): neither knob makes a resolve stick. A rule is recomputed over a ROLLING WINDOW on every
 * tick, so while the window still holds the events that tripped it the condition is STILL TRUE and reopenRecent
 * re-opens the row a person just closed (reopenMin=0 does not help — it only turns the re-open into a brand-new
 * incident). That is what the HOLD is for: see holdActive / POST /api/alerts/:id/resolve {hold}. */
/* a hold is running when held_until is still in the future. The tick's sweep has already cleared the
 * expired ones, so this is a belt-and-braces check against the few seconds a long tick can take. */
function holdActive(rule) {
  if (!rule || !rule.held_until) return false;
  const t = new Date(rule.held_until).getTime();
  return Number.isFinite(t) && t > Date.now();
}
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
       peak_value=GREATEST(coalesce(peak_value,0),$3), breach_count=breach_count+1, reopen_count=coalesce(reopen_count,0)+1, message=$5,
       severity=$6, rule_severity=$7, customers=COALESCE($8, customers), services=COALESCE($9, services), resolve_reason=NULL, resolved_by=NULL
     WHERE id=$1`, [prev.id, now, ev.value, ev.sample, msg, ev.severity, ev.downgraded ? ev.rule_severity : null, ev.customers, ev.services]);
  await c.query(`INSERT INTO incident_comments (alert_id, author, body) VALUES ($1,'system',$2)`,
    [prev.id, `Re-opened: condition returned within ${cfg.reopenMin} min of resolving (flap) — same incident${prev.ack_by ? `, still owned by ${prev.ack_by}` : ''}`]).catch(() => {});
  return true;
}

/* "data as of" — the freshness of the dataset behind the rule at the moment the incident is written (datasets.js):
 * a custom metric names its dataset; a code metric is mapped by its source table / segment. */
async function dataAsOf(rule) {
  const ds = require('./datasets'); const m = require('./metrics').METRICS[rule.metric_key] || {};
  let key = null;
  if (m.custom && m.sourceTables) { const t = String(m.sourceTables).split('.').pop(); const d = ds.REGISTRY.find(x => x.table === t && x.segment === (rule.segment || 'mvno')); key = d && d.key; }
  else { const src = String(m.sourceTables || ''); const d = ds.REGISTRY.find(x => x.table && !x.info && x.segment === (rule.segment || 'mvno') && src.includes(x.table)); key = d ? d.key : ((rule.segment || 'mvno') === 'fixed' ? 'fixed_error_events' : null); }
  return key ? ds.asOf(key) : '';
}

function fmt(v, rule) {
  v = Number(v);
  return ['rate', 'ratio'].includes(rule.unit) ? (v * 100).toFixed(1) + '%' : (Number.isInteger(v) ? v : v.toFixed(2));
}

module.exports = { runAlerts, evaluate, holdActive };
