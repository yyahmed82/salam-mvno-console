/* execRadar.js — the case file behind one radar contact (13 Sep 2026).
 *
 *   GET /api/exec/radar/cell?biz=mobile|fixed[&sev=P1|P2|P3][&slot=YYYY-MM-DDTHH[&older=1]][&day=YYYY-MM-DD][&days=N][&open=1]
 *                                                                           (gate: that business)
 *
 * The Executive radar is a 12-HOUR CLOCK (16 Sep 2026): sector = KSA clock hour, ring = severity, one
 * sweep = the last 12 hours. A blip is one (hour x severity) cell for one business. Clicking it asks for
 * that cell: every distinct RULE that fired in it, and for each one who has it, how long it has been
 * open, the acknowledgement SLA it is being measured against, and how long this rule has historically
 * taken to clear. `older=1` (the oldest sector) also includes rules that are STILL OPEN but fired before
 * the window — the clock pins them there so nothing open ever falls off the face.
 *
 * Omit `slot`/`day` (and `sev`) and it answers for the whole window; `open=1` keeps only rules that are
 * still breaching, regardless of when they fired (open is open). `radarRows(seg)` is the shared query
 * behind the face itself, used by mvnoExec.js and fixedExec.js.
 *
 * WHAT IS REAL AND WHAT IS NOT — this file invents nothing:
 *   owner        alerts.assignee, else alerts.ack_by (who acknowledged it). NULL = nobody has taken it.
 *   ticket       alerts.sn_number (ServiceNow), when the integration has pushed one.
 *   ack SLA      the configured acknowledgement ladder (Settings > SLA), per business and priority:
 *                r1/r2/r3 minutes after firing. Elapsed uses opened_wall (real clock) exactly like
 *                ackSla.js, so replay / sim clocks never make an alert look overdue.
 *   MTTR         measured from this rule's OWN resolved history: avg and median of
 *                (resolved_at - fired_at). Null when the rule has never been resolved — reported as
 *                "no resolved history", never as zero.
 *   ETA          NOT CAPTURED ANYWHERE. There is no ETA / target-resolution field on alerts, so none is
 *                shown. The honest stand-ins are the ack SLA due time and the rule's own MTTR, and the
 *                payload says so in `missing` rather than printing a made-up date.
 *
 * FIXED reads the same `alerts` table with segment 'fixed' (16 Sep 2026; before that it read the old prod
 * engine's sda_ops.alert_events, which never matched the console's own fixed_* incidents).
 * Read-only; nothing here writes. */
'use strict';
const db = require('./db');
const SEG = require('./segment');
const ackSla = require('./ackSla');

const n = v => Number(v) || 0;
const SEVS = new Set(['P1', 'P2', 'P3', 'P4']);
const minsBetween = (a, b) => (a && b) ? Math.round((new Date(b) - new Date(a)) / 60000) : null;
const isDay = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
const isSlot = d => /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(String(d || ''));

/* ---------------------------------------------------------------- the clock face: shared by both businesses */
const RADAR_HOURS = 12;
/* KSA clock-hour key 'YYYY-MM-DDTHH' — the same key in SQL and in JS, so cells and axis always match */
const SLOT = col => `to_char(date_trunc('hour', (${col}) AT TIME ZONE 'Asia/Riyadh'), 'YYYY-MM-DD"T"HH24')`;
const slotKey = t => new Date(t + 3 * 3600e3).toISOString().slice(0, 13);
const hourFloor = t => Math.floor(t / 3600e3) * 3600e3;
const windowFrom = hours => new Date(hourFloor(Date.now()) - (hours - 1) * 3600e3).toISOString();   // start of the oldest sector
const slotAxis = hours => { const h0 = hourFloor(Date.now()), out = []; for (let i = hours - 1; i >= 0; i--) out.push(slotKey(h0 - i * 3600e3)); return out; };
/* rows:   one per (slot x severity): n = DISTINCT rules fired in that hour, open = of those still open,
 *         older = still-open rules that fired BEFORE the window and were pinned into the oldest sector
 * totals: one per severity for the whole face, queried apart (a rule firing in five hours is ONE rule)
 * Open incidents are always counted, whenever they fired: the face is an instrument of NOW. */
async function radarRows(seg, hours = RADAR_HOURS) {
  const from = windowFrom(hours), W = SEG.sqlWhere('a', 'rule_key', seg);
  const q = (sql, p) => db.console.query(sql, p).then(r => r.rows, e => { console.error('[execRadar] radar query failed:', e.message); return []; });
  const [rows, totals] = await Promise.all([
    q(`SELECT ${SLOT('GREATEST(a.fired_at, $1::timestamptz)')} AS slot, a.severity,
              count(DISTINCT a.rule_key)::int AS n,
              count(DISTINCT a.rule_key) FILTER (WHERE a.status = 'open')::int AS open,
              count(DISTINCT a.rule_key) FILTER (WHERE a.status = 'open' AND a.fired_at < $1::timestamptz)::int AS older,
              count(*)::int AS firings,
              (array_agg(DISTINCT coalesce(a.name, a.rule_key)))[1:4] AS rules
         FROM alerts a WHERE ${W} AND (a.fired_at >= $1::timestamptz OR a.status = 'open') GROUP BY 1, 2`, [from]),
    q(`SELECT a.severity, count(DISTINCT a.rule_key)::int AS rules,
              count(DISTINCT a.rule_key) FILTER (WHERE a.status = 'open')::int AS open,
              count(*)::int AS firings
         FROM alerts a WHERE ${W} AND (a.fired_at >= $1::timestamptz OR a.status = 'open') GROUP BY 1`, [from]),
  ]);
  return { slots: slotAxis(hours), rows, totals, from, hours };
}

/* ---------------------------------------------------------------- console DB `alerts`, one segment */
const M_COLS = `a.id, a.rule_key, a.name, a.severity, a.team, a.status, a.message,
                a.observed_value, a.threshold, a.peak_value, a.breach_count, a.window_hours,
                a.fired_at, a.last_seen_at, a.resolved_at, a.opened_wall, a.snoozed_until,
                a.assignee, a.ack_by, a.ack_at, a.ack_reminder_level, a.ack_reminder_at, a.sn_number, a.note`;

async function consoleCell(seg, { day, sev, days, slot, older, openOnly }) {
  const C = db.console;
  const segWhere = SEG.sqlWhere('a', 'rule_key', seg);
  const biz = seg === 'fixed' ? 'fixed' : 'mobile';
  const w = [segWhere], pp = [];
  if (sev) { pp.push(sev); w.push(`a.severity = $${pp.length}`); }
  if (slot) {
    pp.push(slot); const eq = `${SLOT('a.fired_at')} = $${pp.length}`;
    if (older) { pp.push(windowFrom(RADAR_HOURS)); w.push(`(${eq} OR (a.status = 'open' AND a.fired_at < $${pp.length}::timestamptz))`); }
    else w.push(eq);
  }
  else if (day) { pp.push(day); w.push(`(a.fired_at AT TIME ZONE 'Asia/Riyadh')::date = $${pp.length}::date`); }
  else if (!openOnly) { pp.push(days); w.push(`a.fired_at >= now() - ($${pp.length}::int || ' days')::interval`); }
  if (openOnly) w.push(`a.status = 'open' AND a.resolved_at IS NULL`);
  const rows = (await C.query(
    `SELECT ${M_COLS} FROM alerts a WHERE ${w.join(' AND ')}
      ORDER BY (a.status = 'open') DESC, a.severity, a.fired_at DESC LIMIT 60`, pp)).rows;
  if (!rows.length) return { rules: [], ladder: null };

  /* MTTR from each rule's own resolved history — all time, not just this window, so a rule that
   * fires once a week still has a number. */
  const keys = [...new Set(rows.map(r => r.rule_key))];
  const mttr = {};
  try {
    (await C.query(
      `SELECT rule_key, count(*)::int n,
              round(avg(extract(epoch FROM (resolved_at - fired_at)) / 60))::int avg_min,
              round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (resolved_at - fired_at)) / 60))::int p50_min
         FROM alerts WHERE rule_key = ANY($1) AND resolved_at IS NOT NULL AND resolved_at >= fired_at
        GROUP BY 1`, [keys])).rows.forEach(r => mttr[r.rule_key] = { n: n(r.n), avgMin: n(r.avg_min), p50Min: n(r.p50_min) });
  } catch (_) { /* leave MTTR unknown rather than guessing */ }

  const cfg = await ackSla.getConfig().catch(() => null);
  const bcfg = cfg && cfg[biz], ladder = bcfg && bcfg[sev] ? bcfg[sev] : null;
  const slaOn = !!(cfg && cfg.enabled && bcfg && bcfg.enabled);
  const now = Date.now();

  const rules = rows.map(a => {
    const open = a.status === 'open' && !a.resolved_at;
    const startedAt = a.opened_wall || a.fired_at;                 // real clock, like ackSla.js
    const openMin = open ? minsBetween(startedAt, now) : minsBetween(a.fired_at, a.resolved_at);
    const acked = !!a.ack_at;
    const owner = a.assignee || a.ack_by || null;
    const m = mttr[a.rule_key] || null;
    let ack = null;
    if (ladder) {
      const dueAt = new Date(new Date(startedAt).getTime() + n(ladder.r1) * 60000).toISOString();
      const escAt = new Date(new Date(startedAt).getTime() + n(ladder.r3) * 60000).toISOString();
      const elapsed = minsBetween(startedAt, acked ? a.ack_at : now);
      ack = { enabled: slaOn, targetMin: n(ladder.r1), escalateMin: n(ladder.r3), dueAt, escalateAt: escAt,
        level: n(a.ack_reminder_level), lastReminderAt: a.ack_reminder_at,
        elapsedMin: elapsed, met: acked ? elapsed <= n(ladder.r1) : null,
        overdue: !acked && open && slaOn && n(ladder.r1) > 0 && elapsed >= n(ladder.r1),
        overdueByMin: !acked && open && n(ladder.r1) > 0 ? Math.max(0, elapsed - n(ladder.r1)) : 0 };
    }
    return {
      id: a.id, key: a.rule_key, name: a.name, severity: a.severity, team: a.team || null,
      status: open ? 'open' : 'cleared', firedAt: a.fired_at, lastSeenAt: a.last_seen_at,
      resolvedAt: a.resolved_at, snoozedUntil: a.snoozed_until, openMin,
      owner, ownerFrom: a.assignee ? 'assigned' : a.ack_by ? 'acknowledged' : null,
      ackAt: a.ack_at, ackBy: a.ack_by, ticket: a.sn_number || null, note: a.note || null,
      observed: a.observed_value == null ? null : Number(a.observed_value),
      threshold: a.threshold == null ? null : Number(a.threshold),
      peak: a.peak_value == null ? null : Number(a.peak_value),
      breachCount: n(a.breach_count), windowHours: a.window_hours == null ? null : Number(a.window_hours),
      message: a.message || null, ack,
      mttr: m && m.n ? { avgMin: m.avgMin, p50Min: m.p50Min, samples: m.n } : null,
      href: seg === 'fixed' ? `#fixed?tab=alerts&rule=${encodeURIComponent(a.rule_key)}` : `#alerts?rule=${encodeURIComponent(a.rule_key)}`,
    };
  });
  return { rules, ladder: ladder ? { enabled: slaOn, ...ladder } : null };
}
const mobileCell = q => consoleCell('mvno', q);
/* Fixed reads the SAME console table (segment 'fixed'): the unified engine's fixed_* incidents carry owner,
 * ack, resolution and ticket exactly like Mobile's. The old sda_ops.alert_events evaluation log is no
 * longer consulted — it had none of that, and its rules never matched Fixed › Alerts. */
const fixedCell = q => consoleCell('fixed', q);

/* ---------------------------------------------------------------- mount */
function mount(app, { requireView }) {
  const GATE = { mobile: 'dashboard', fixed: 'fixed' };
  app.get('/api/exec/radar/cell', (req, res, next) => {
    const biz = req.query.biz === 'fixed' ? 'fixed' : 'mobile';
    return requireView(GATE[biz])(req, res, next);
  }, async (req, res) => {
    try {
      const biz = req.query.biz === 'fixed' ? 'fixed' : 'mobile';
      const sev = req.query.sev ? String(req.query.sev).toUpperCase() : null;
      const day = req.query.day ? String(req.query.day) : null;
      const days = Math.min(90, Math.max(1, Number(req.query.days || 7)));
      const openOnly = req.query.open === '1' || req.query.open === 'true';
      const slot = req.query.slot ? String(req.query.slot) : null;
      const older = req.query.older === '1' || req.query.older === 'true';
      if (sev && !SEVS.has(sev)) return res.status(400).json({ error: 'sev must be P1, P2, P3 or P4' });
      if (day && !isDay(day)) return res.status(400).json({ error: 'day must be YYYY-MM-DD (KSA)' });
      if (slot && !isSlot(slot)) return res.status(400).json({ error: 'slot must be YYYY-MM-DDTHH (KSA clock hour)' });
      const q = { day, sev, days, slot, older, openOnly };
      const out = biz === 'fixed' ? await fixedCell(q) : await mobileCell(q);
      res.json({
        biz, label: biz === 'fixed' ? 'Fixed' : 'Mobile', sev, day, slot, older, days: (day || slot || openOnly) ? null : days, openOnly,
        generatedAt: new Date().toISOString(),
        source: 'unified_console.alerts',
        open: out.rules.filter(r => r.status === 'open').length,
        rules: out.rules, ladder: out.ladder || null,
        /* no ETA field exists on either side — say so instead of printing an invented date */
        missing: (out.missing || []).concat(['no ETA / target-resolution field is captured on alerts — the acknowledgement SLA due time and the rule\'s own MTTR are what this console can measure']),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}
module.exports = { mount, mobileCell, fixedCell, radarRows, RADAR_HOURS };
