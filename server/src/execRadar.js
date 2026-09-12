/* execRadar.js — the case file behind one radar contact (13 Sep 2026).
 *
 *   GET /api/exec/radar/cell?biz=mobile|fixed[&sev=P1|P2|P3][&day=YYYY-MM-DD][&days=7|30][&open=1]
 *                                                                           (gate: that business)
 *
 * A blip on the Executive radar is one (KSA day x severity) cell for one business. Clicking it asks for
 * that cell: every distinct RULE that fired in it, and for each one who has it, how long it has been
 * open, the acknowledgement SLA it is being measured against, and how long this rule has historically
 * taken to clear.
 *
 * Omit `day` (and `sev`) and it answers for the WHOLE window instead — `days` back from now — which is
 * how the scope's console lists everything still open without asking cell by cell. `open=1` keeps only
 * rules that are still breaching.
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
 * FIXED is a different source: sda_ops.alert_events is an evaluation log with no ack, assignee,
 * resolution or ticket columns, so a Fixed case file carries what that log really has — team, first and
 * last firing, how many evaluations breached, and whether the newest evaluation is still FIRED — and
 * declares the rest as not wired instead of leaving blank fields that look like "nobody is on it".
 * Read-only; nothing here writes. */
'use strict';
const db = require('./db');
const SEG = require('./segment');
const ackSla = require('./ackSla');

const n = v => Number(v) || 0;
const SEVS = new Set(['P1', 'P2', 'P3', 'P4']);
const minsBetween = (a, b) => (a && b) ? Math.round((new Date(b) - new Date(a)) / 60000) : null;
const isDay = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));

/* ---------------------------------------------------------------- mobile: console DB `alerts` */
const M_COLS = `a.id, a.rule_key, a.name, a.severity, a.team, a.status, a.message,
                a.observed_value, a.threshold, a.peak_value, a.breach_count, a.window_hours,
                a.fired_at, a.last_seen_at, a.resolved_at, a.opened_wall, a.snoozed_until,
                a.assignee, a.ack_by, a.ack_at, a.ack_reminder_level, a.ack_reminder_at, a.sn_number, a.note`;

async function mobileCell({ day, sev, days, openOnly }) {
  const C = db.console;
  const segWhere = SEG.sqlWhere('a', 'rule_key', 'mvno');
  const w = [segWhere], pp = [];
  if (sev) { pp.push(sev); w.push(`a.severity = $${pp.length}`); }
  if (day) { pp.push(day); w.push(`(a.fired_at AT TIME ZONE 'Asia/Riyadh')::date = $${pp.length}::date`); }
  else { pp.push(days); w.push(`a.fired_at >= now() - ($${pp.length}::int || ' days')::interval`); }
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
  const biz = cfg && cfg.mobile, ladder = biz && biz[sev] ? biz[sev] : null;
  const slaOn = !!(cfg && cfg.enabled && biz && biz.enabled);
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
      href: `#alerts?rule=${encodeURIComponent(a.rule_key)}`,
    };
  });
  return { rules, ladder: ladder ? { enabled: slaOn, ...ladder } : null };
}

/* ---------------------------------------------------------------- fixed: sda_ops.alert_events */
async function fixedCell({ day, sev, days, openOnly }) {
  const P = db.ops; if (!P) return { rules: [], ladder: null, missing: ['OPS_DATABASE_URL not set'] };
  const w = [`e.status = 'FIRED'`], pp = [];
  if (sev) { pp.push(sev); w.push(`e.severity = $${pp.length}`); }
  if (day) { pp.push(day); w.push(`(e.fired_at AT TIME ZONE 'Asia/Riyadh')::date = $${pp.length}::date`); }
  else { pp.push(days); w.push(`e.fired_at >= now() - ($${pp.length}::int || ' days')::interval`); }
  const having = openOnly ? `HAVING max(l.status) = 'FIRED'` : '';
  const rows = (await P.query(
    `WITH last AS (SELECT DISTINCT ON (rule_key) rule_key, status, fired_at, metric_value, metric_text
                     FROM alert_events ORDER BY rule_key, fired_at DESC)
     SELECT e.rule_key, max(e.rule_name) AS name, max(e.team) AS team, count(*)::int AS firings,
            min(e.fired_at) AS first_at, max(e.fired_at) AS last_at, max(e.severity) AS severity,
            max(e.threshold) AS threshold, max(e.metric_value) AS metric_value, max(e.metric_text) AS metric_text,
            max(l.status) AS last_status, max(l.fired_at) AS last_eval_at
       FROM alert_events e LEFT JOIN last l ON l.rule_key = e.rule_key
      WHERE ${w.join(' AND ')}
      GROUP BY e.rule_key ${having} ORDER BY max(e.fired_at) DESC LIMIT 60`, pp)).rows;
  const now = Date.now();
  return {
    ladder: null,
    rules: rows.map(r => ({
      id: null, key: r.rule_key, name: r.name || r.rule_key, severity: r.severity || sev, team: r.team || null,
      status: r.last_status === 'FIRED' ? 'open' : 'cleared',
      firedAt: r.first_at, lastSeenAt: r.last_at, resolvedAt: null,
      openMin: r.last_status === 'FIRED' ? minsBetween(r.first_at, now) : minsBetween(r.first_at, r.last_at),
      owner: null, ownerFrom: null, ackAt: null, ackBy: null, ticket: null, note: null,
      observed: r.metric_value == null ? null : Number(r.metric_value),
      threshold: r.threshold == null ? null : Number(r.threshold),
      peak: null, breachCount: n(r.firings), windowHours: null,
      message: r.metric_text || null, ack: null, mttr: null,
      href: `#fixed?tab=alerts&rule=${encodeURIComponent(r.rule_key)}`,
    })),
    /* said out loud rather than rendered as empty owner / SLA fields, which would read as
     * "nobody is on it" when the truth is "this source does not record it" */
    missing: ['alert_events is an evaluation log: it records no owner, acknowledgement, resolution time or ticket for Fixed rules — only that a rule breached and when'],
  };
}

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
      if (sev && !SEVS.has(sev)) return res.status(400).json({ error: 'sev must be P1, P2, P3 or P4' });
      if (day && !isDay(day)) return res.status(400).json({ error: 'day must be YYYY-MM-DD (KSA)' });
      const q = { day, sev, days, openOnly };
      const out = biz === 'fixed' ? await fixedCell(q) : await mobileCell(q);
      res.json({
        biz, label: biz === 'fixed' ? 'Fixed' : 'Mobile', sev, day, days: day ? null : days, openOnly,
        generatedAt: new Date().toISOString(),
        source: biz === 'fixed' ? 'sda_ops.alert_events' : 'unified_console.alerts',
        open: out.rules.filter(r => r.status === 'open').length,
        rules: out.rules, ladder: out.ladder || null,
        /* no ETA field exists on either side — say so instead of printing an invented date */
        missing: (out.missing || []).concat(['no ETA / target-resolution field is captured on alerts — the acknowledgement SLA due time and the rule\'s own MTTR are what this console can measure']),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}
module.exports = { mount, mobileCell, fixedCell };
