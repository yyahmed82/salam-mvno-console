/* alertReport.js — one PDF report per FIRING alert, attached to the alert mail.
 *
 * PURPOSE: the digest table says WHAT fired; the attached report says everything an L1 needs to
 * act without opening a single query themselves — the rule in plain words, the KPIs, the recent
 * evidence (which API, which codes, real request outcomes), the alert's own history, and a
 * numbered action plan (the rule's curated runbook + the standard escalation ladder).
 *
 * DESIGN RULES
 *   · Read-only, console DB only. Bounded queries with LIMITs — a mail must never load prod.
 *   · Evidence is metric-family driven: an api_latency alert shows the slow paths, a Semati
 *     alert shows Semati calls, a payment alert shows the failing payment endpoints. Sourced
 *     from api_traffic_events (7-day retention, response_message pre-masked before storage —
 *     so the PDF carries no PII by construction).
 *   · Every failure is contained: a report that cannot be built is skipped with a note; the
 *     mail itself must always go out.
 *   · Max N attachments (default 6) — a storm of 20 alerts must not build a 20-PDF mail.
 */
'use strict';

const db = require('./db');
const pdfout = require('./pdfout');

const BASE = process.env.CONSOLE_BASE_URL || 'https://salam.sa/digital-console/';
const opLabel = { gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '=' };

const ksa = iso => { try {
  return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '');
} catch (e) { return String(iso || '—'); } };
const fmtVal = (v, unit) => v == null ? '—'
  : (['rate', 'ratio'].includes(unit) ? (Number(v) * 100).toFixed(1) + '%'
    : (Number.isInteger(Number(v)) ? String(v) : Number(v).toFixed(2)));

/* which api_traffic_events slice is EVIDENCE for a metric — family match, first hit wins.
 * A rule with dim.api gets that exact path instead. */
const EVIDENCE = [
  [/^semati/, `path ILIKE '%semati%'`],
  [/^nafath/, `path ILIKE '%nafath%'`],
  [/^otp|^sms/, `(path ILIKE '%otp%' OR path ILIKE '%sms%')`],
  [/^payment|^gateway|^recharge|samsung|^web_checkout/, `(path ILIKE '%payment%' OR path ILIKE '%recharge%' OR path ILIKE '%checkout%' OR path ILIKE '%voucher%')`],
  [/^activation|^bss/, `(path ILIKE '%activation%' OR path ILIKE '%bss%' OR path ILIKE '%subscription%')`],
  [/^app_auth/, `(path ILIKE '%sign_in%' OR path ILIKE '%auth%' OR path ILIKE '%login%')`],
  [/^eligibility/, `path ILIKE '%eligib%'`],
];

/* the standard ladder appended to every runbook, per severity — the part L1 must never
 * have to remember under pressure */
const LADDER = {
  P1: ['Acknowledge in the console (Alerts page) so the team sees it is being worked.',
       'Follow the rule runbook above; capture evidence (codes, refs, timestamps) as you go.',
       'Page the on-call L2 for the owning team NOW — P1 does not wait for a diagnosis.',
       'Open / join the MIM bridge and log an incident ticket; keep updates flowing every 15 min.',
       'Do NOT close on a green dashboard alone — verify with a real transaction where possible.'],
  P2: ['Acknowledge in the console (Alerts page).',
       'Work the rule runbook above; if the metric keeps climbing toward the P1 threshold, treat it as the P1 now.',
       'Raise an incident ticket with the evidence from this report; mention the owning-team L2.',
       'Re-check after the next sync cycle — resolve in the console only when the metric is back under threshold.'],
  P3: ['Acknowledge in the console; no paging needed.',
       'Work the runbook when time allows; watch the trend over the next few cycles.',
       'If it recurs daily, propose a threshold or fix via the team channel — chronic P3s hide real regressions.'],
};

async function ruleRow(key) {
  return (await db.console.query(`SELECT * FROM alert_rules WHERE key=$1`, [key])).rows[0] || null;
}

async function buildOne(ev, simNow) {
  const c = db.console;
  const rule = await ruleRow(ev.key);
  const open = (await c.query(
    `SELECT * FROM alerts WHERE rule_key=$1 AND status='open' ORDER BY id DESC LIMIT 1`, [ev.key])).rows[0];
  const history = (await c.query(
    `SELECT fired_at, resolved_at, peak_value, breach_count, sample
       FROM alerts WHERE rule_key=$1 ORDER BY fired_at DESC LIMIT 8`, [ev.key])).rows;
  const dim = (rule && rule.dim) || {};
  const snaps = (await c.query(
    `SELECT sim_now, value, sample FROM metric_snapshots
      WHERE metric_key=$1 AND window_hours=$2 AND dim @> $3::jsonb AND $3::jsonb @> dim
      ORDER BY sim_now DESC LIMIT 16`,
    [ev.metric_key, ev.window_hours, JSON.stringify(dim)])).rows.reverse();

  /* evidence: exact API when the rule names a REAL one (dim.api values like "(worst)" are the
   * evaluator's placeholder, not a path), else the metric family; latency metrics additionally
   * get the "exact APIs facing issues" table ranked by p95 so the breaching endpoint is NAMED. */
  const apiDim = dim.api && !/^\(/.test(String(dim.api)) ? dim.api : null;
  const isLatency = /latency/.test(ev.metric_key);
  const evWin = `${Math.max(ev.window_hours * 4, 6)} hours`;
  let evTitle = null, evCodes = [], evRows = [], evSlow = [];
  try {
    const fam = (EVIDENCE.find(([re]) => re.test(ev.metric_key)) || [])[1];
    const where = apiDim ? `path = $2` : fam;
    if (isLatency) {
      /* which endpoints are actually slow, worst first — p95 per path over the window */
      evSlow = (await c.query(
        `SELECT path, count(*)::int n, round(avg(duration_ms))::int avg_ms,
                percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms)::int p95_ms,
                max(duration_ms)::int max_ms,
                count(*) FILTER (WHERE err_class='technical')::int tech
           FROM api_traffic_events
          WHERE ts >= now()-$1::interval AND duration_ms IS NOT NULL
            ${apiDim ? 'AND path = $2' : ''}
          GROUP BY 1 HAVING count(*) >= 20
          ORDER BY p95_ms DESC LIMIT 10`, apiDim ? [evWin, apiDim] : [evWin])).rows;
      evTitle = apiDim ? `API: ${apiDim}` : 'slowest endpoints in the window';
    }
    if (where) {
      const P = apiDim ? [evWin, apiDim] : [evWin];
      evTitle = evTitle || (apiDim ? `API: ${apiDim}` : 'APIs of this metric family');
      evCodes = (await c.query(
        `SELECT path, coalesce(response_code,'—') code,
                coalesce(NULLIF(left(response_message,70),''),'(no message)') msg,
                coalesce(err_class,'—') cls, count(*)::int n, round(avg(duration_ms))::int avg_ms
           FROM api_traffic_events WHERE ts >= now()-$1::interval AND ${where}
          GROUP BY 1,2,3,4 ORDER BY n DESC LIMIT 8`, P)).rows;
      evRows = (await c.query(
        `SELECT ts, host, path, transaction_id, coalesce(response_code,'—') code,
                coalesce(NULLIF(left(response_message,80),''),'(no message)') msg, duration_ms
           FROM api_traffic_events WHERE ts >= now()-$1::interval AND ${where}
            AND coalesce(err_class,'') <> 'success'
          ORDER BY ts DESC LIMIT 10`, P)).rows;
    } else if (isLatency && evSlow.length) {
      /* latency alert with no family filter: recent SLOW calls on the worst endpoint are the
       * failing evidence — a latency breach rarely writes an error row */
      evRows = (await c.query(
        `SELECT ts, host, path, transaction_id, coalesce(response_code,'—') code,
                coalesce(NULLIF(left(response_message,80),''),'(no message)') msg, duration_ms
           FROM api_traffic_events WHERE ts >= now()-$1::interval AND path = $2
          ORDER BY duration_ms DESC NULLS LAST LIMIT 8`, [evWin, evSlow[0].path])).rows;
    }
  } catch (e) { evTitle = null; }

  /* REAL EXAMPLE — one captured call end to end (request body -> response body), so L1 sees what
   * the customer's app actually sent and what came back. On-demand SSH grep of the api_logger
   * file (same source as the console's trace view); PII masked; headers never returned. Hard
   * 10s budget — a slow host must not delay the alert mail. */
  let example = null;
  try {
    const cand = evRows.find(r => r.transaction_id);
    if (cand) {
      const roles = require('./roles');
      const d = await Promise.race([
        require('./apiLogCollector').fetchTxnPayloads(cand.transaction_id),
        new Promise((_, rej) => setTimeout(() => rej(new Error('payload fetch timeout (10s)')), 10000)),
      ]);
      const row = d && d.rows && roles.maskDeep(d, false).rows.find(r => r.request_body != null || r.response_body != null);
      if (row) example = { ...row, transaction_id: cand.transaction_id, code: cand.code, msg: cand.msg, ts: cand.ts };
    }
  } catch (e) { example = { error: e.message }; }

  /* ---- compose the PDF -------------------------------------------------------------------- */
  const d = pdfout.doc({ footer: `Salam Digital Console - automated alert report - generated ${ksa(simNow)} KSA` });
  const CC = d.colors;
  const sev = ev.severity || 'P3';
  const sevColor = sev === 'P1' ? CC.red : sev === 'P2' ? CC.amber : CC.muted;

  const top = d.band(64, CC.dark);
  d.at(M0(), top + 24, 'ALERT REPORT', { size: 9, bold: true, color: [0.5, 0.83, 0.65] });
  d.at(M0(), top + 44, `${sev} - ${ev.name}`, { size: 15, bold: true, color: CC.white });
  d.space(10);

  d.kv([
    ['Status', open ? `OPEN since ${ksa(open.fired_at)} KSA (breached ${open.breach_count}x, peak ${fmtVal(open.peak_value, ev.unit)})` : 'firing (opening this cycle)'],
    ['Alert id', open ? `#${open.id}` : '—'],
    ['Team', ev.team || '—'],
    ['Class', (rule && rule.alert_class) || '—'],
    ['Metric', ev.metric_key + (Object.keys(dim).length ? `  dim ${JSON.stringify(dim)}` : '')],
    ['Observed', `${fmtVal(ev.value, ev.unit)}  (sample ${ev.sample}, window ${ev.window_hours}h)`],
    ['Threshold', `${opLabel[ev.operator] || ev.operator} ${fmtVal(ev.threshold, ev.unit)}` + (ev.min_sample ? `  min sample ${ev.min_sample}` : '') + (ev.active ? `  active ${ev.active}` : '')],
    ['Console', `${BASE}#alerts   (acknowledge / history)      ${BASE}#troubleshoot   (live drill)`],
  ], { boldVal: true });

  if (rule && rule.description) { d.h2('What this alert means'); d.p(rule.description); }

  d.h2('KPIs - the metric leading up to this alert');
  const OPS = { gt: (a, b) => a > b, gte: (a, b) => a >= b, lt: (a, b) => a < b, lte: (a, b) => a <= b, eq: (a, b) => a === b };
  const breached = s => s && s.value != null && OPS[ev.operator]
    && OPS[ev.operator](Number(s.value), Number(ev.threshold));
  if (snaps.length) {
    d.table(
      [{ label: 'Snapshot (KSA)', w: 22 }, { label: 'Value', w: 12, align: 'right' },
       { label: 'Sample', w: 12, align: 'right' }, { label: 'vs threshold', w: 16 }],
      snaps.map(s => [ksa(s.sim_now), fmtVal(s.value, ev.unit), String(s.sample ?? '—'),
        s.value == null ? '—' : (breached(s) ? 'BREACH' : 'ok')]),
      { rowColor: ri => breached(snaps[ri]) ? CC.red : null });
  } else d.p('No snapshot history stored for this metric/window.');

  if (evTitle) {
    d.h2(`Evidence - ${evTitle} (console API capture, last ${Math.max(ev.window_hours * 4, 6)}h)`);
    if (isLatency && evSlow.length) {
      d.p('Exact APIs facing issues - every endpoint ranked by its p95 in the window (worst first):', { color: CC.muted });
      d.table(
        [{ label: 'API endpoint', w: 40 }, { label: 'Calls', w: 9, align: 'right' },
         { label: 'Avg ms', w: 9, align: 'right' }, { label: 'p95 ms', w: 10, align: 'right' },
         { label: 'Max ms', w: 10, align: 'right' }, { label: 'Tech fails', w: 10, align: 'right' }],
        evSlow.map(r => [r.path, String(r.n), String(r.avg_ms ?? '—'), String(r.p95_ms ?? '—'),
                         String(r.max_ms ?? '—'), String(r.tech)]),
        { rowColor: ri => ri === 0 ? CC.red : (evSlow[ri].tech > 0 ? CC.amber : null) });
    }
    if (evCodes.length) {
      d.p('Outcome mix per endpoint - which API and which response dominates:', { color: CC.muted });
      d.table(
        [{ label: 'API path', w: 30 }, { label: 'Code', w: 8 }, { label: 'Response message', w: 34 },
         { label: 'Class', w: 10 }, { label: 'Count', w: 8, align: 'right' }, { label: 'Avg ms', w: 8, align: 'right' }],
        evCodes.map(r => [r.path, r.code, r.msg, r.cls, String(r.n), r.avg_ms == null ? '—' : String(r.avg_ms)]),
        { rowColor: ri => evCodes[ri].cls === 'technical' ? CC.red : (evCodes[ri].cls === 'business' ? CC.amber : null) });
      if (evRows.length) {
        d.p(isLatency && !evCodes.length ? 'Slowest individual calls on the worst endpoint:'
          : 'Most recent non-success calls (masked at capture):', { color: CC.muted });
        d.table(
          [{ label: 'When (KSA)', w: 16 }, { label: 'Host', w: 8 }, { label: 'API path', w: 26 },
           { label: 'Code', w: 8 }, { label: 'Response', w: 32 }, { label: 'ms', w: 7, align: 'right' }],
          evRows.map(r => [ksa(r.ts), r.host, r.path, r.code, r.msg, r.duration_ms == null ? '—' : String(r.duration_ms)]));
      } else d.p('No non-success calls captured in the window - the breach may be volume- or latency-driven rather than error-driven.');
    } else if (evRows.length) {
      d.p('Slowest individual calls on the worst endpoint:', { color: CC.muted });
      d.table(
        [{ label: 'When (KSA)', w: 16 }, { label: 'Host', w: 8 }, { label: 'API path', w: 26 },
         { label: 'Code', w: 8 }, { label: 'Response', w: 32 }, { label: 'ms', w: 7, align: 'right' }],
        evRows.map(r => [ksa(r.ts), r.host, r.path, r.code, r.msg, r.duration_ms == null ? '—' : String(r.duration_ms)]));
    } else if (!evSlow.length) d.p('The API capture holds no rows for this family in the window (7-day retention; collector live since 13 Aug 2026).');
    d.p('Full traces: console -> Troubleshoot -> open any failure -> trace (end-to-end app -> gateway -> BSS/UPG).', { color: CC.muted });
  }

  /* real example — the actual request and response of one of the calls above */
  if (example && !example.error) {
    d.h2('Real example - one captured call, request and response');
    d.kv([
      ['Call', `${example.method || 'POST'} ${example.path || '—'}`],
      ['When / outcome', `${ksa(example.ts)} KSA - code ${example.code} - ${example.msg}${example.duration ? ` - ${example.duration} ms` : ''}`],
      ['Transaction', example.transaction_id],
    ]);
    const trim = v => { try { return JSON.stringify(v, null, 1); } catch (e) { return String(v); } };
    d.p('Request body (PII masked, headers never included):', { bold: true, size: 9 });
    d.code(example.request_body != null ? trim(example.request_body) : '(no body captured)');
    d.p('Response body:', { bold: true, size: 9 });
    d.code(example.response_body != null ? trim(example.response_body) : '(no body captured)');
    d.p(`Same call in the console: Troubleshoot -> search the transaction id above for the full end-to-end trace.`, { color: CC.muted, size: 8.5 });
  } else if (example && example.error) {
    d.p(`Real-example fetch skipped: ${example.error} (open the transaction in the console trace instead).`, { color: CC.muted, size: 8.5 });
  }

  d.h2('History - the last firings of this rule');
  if (history.length) {
    d.table(
      [{ label: 'Fired (KSA)', w: 18 }, { label: 'Resolved (KSA)', w: 18 },
       { label: 'Duration', w: 12 }, { label: 'Peak', w: 10, align: 'right' },
       { label: 'Breaches', w: 10, align: 'right' }, { label: 'Sample', w: 10, align: 'right' }],
      history.map(h => {
        const dur = h.resolved_at ? Math.round((new Date(h.resolved_at) - new Date(h.fired_at)) / 60000) + ' min' : 'still open';
        return [ksa(h.fired_at), h.resolved_at ? ksa(h.resolved_at) : '—', dur,
                fmtVal(h.peak_value, ev.unit), String(h.breach_count ?? '—'), String(h.sample ?? '—')];
      }));
  } else d.p('First time this rule fires.');

  d.h2('What L1 should do - action plan');
  const rb = (rule && rule.runbook) || '';
  const steps = rb.split(/\s*\d+\)\s*/).filter(s => s.trim());
  if (steps.length) steps.forEach((s, i) => d.p(`${i + 1}.  ${s.trim()}`, { indent: 4, gap: 3 }));
  else d.p('No curated runbook on this rule yet - add one in the console (Alerts -> rule -> runbook).');
  if (rule && rule.trigger_codes) d.p(`Trigger codes to look for: ${rule.trigger_codes}`, { color: CC.muted });
  d.space(4);
  d.p(`Then, standard ${sev} ladder:`, { bold: true, size: 9.5 });
  (LADDER[sev] || LADDER.P3).forEach((s, i) => d.p(`${i + 1}.  ${s}`, { indent: 4, gap: 3 }));

  d.space(6); d.hr();
  d.p('This report was generated automatically when the alert fired. Numbers are the console\'s own metric snapshots; evidence rows come from the API-traffic capture on the Digital API hosts (PII masked before storage). Links: open the console and sign in first.', { color: CC.muted, size: 8.5 });

  return d.buffer();
}
/* pdfout draws from margin 46 — tiny helper so band overlays use the same X */
function M0() { return 46; }

/* Build attachments for every FIRING eval. Never throws: a failed report becomes a note. */
async function buildFiredReports(simNow, evals, { max = 6 } = {}) {
  const firing = (evals || []).filter(e => e.fired).slice(0, max);
  const out = { attachments: [], notes: [] };
  for (const ev of firing) {
    try {
      const buf = await buildOne(ev, simNow);
      const stamp = ksa(simNow).replace(/[/: ]/g, '').slice(0, 12);
      out.attachments.push({
        filename: `Alert-${ev.severity}-${String(ev.key).replace(/[^a-z0-9_-]/gi, '_')}-${stamp}KSA.pdf`,
        content: buf, contentType: 'application/pdf',
      });
    } catch (e) { out.notes.push(`${ev.name}: report failed (${e.message})`); }
  }
  if ((evals || []).filter(e => e.fired).length > max)
    out.notes.push(`only the first ${max} firing alerts carry a PDF report`);
  return out;
}

module.exports = { buildFiredReports };
