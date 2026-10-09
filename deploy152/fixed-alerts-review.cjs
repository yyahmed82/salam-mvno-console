#!/usr/bin/env node
/* FIXED ALERTS — noise and threshold census. READ-ONLY: it runs SELECTs and nothing else.
 *
 * WHY: the Fixed side seeds 115 rules. Twelve are flagged noisy in the UI, but "noisy" as the console
 * scores it is an OUTCOME (nobody acked / closed as false positive). To tune a rule you need the CAUSE,
 * and the cause is almost always one number: what share of the time the rule's own condition is already
 * true on its own metric. A rule whose condition holds on 30 % of ticks is not detecting an incident,
 * it is describing normal Tuesday. This script puts the two side by side.
 *
 * Run ON 152 AS USER yosri (pm2/node live under yosri's nvm; sudo -i loses that PATH):
 *   cd /apps/unified/server && node /tmp/fixed-alerts-review.cjs --segment mvno --days 30
 *
 * Reads CONSOLE_DATABASE_URL out of /apps/unified/.env by parsing it IN NODE. Never `set -a; . .env`
 * on this box — values contain spaces and angle brackets and that pattern has broken a cron here before.
 */
'use strict';
const fs = require('fs'), path = require('path');

function loadEnv(p) {
  const out = {}; let txt = '';
  try { txt = fs.readFileSync(p, 'utf8'); } catch (e) { return out; }
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
const ENV = loadEnv(process.env.ENV_FILE || '/apps/unified/.env');
const URL = process.env.CONSOLE_DATABASE_URL || ENV.CONSOLE_DATABASE_URL;
if (!URL) { console.error('✗ CONSOLE_DATABASE_URL not in env or /apps/unified/.env'); process.exit(1); }
let pg; try { pg = require('pg'); } catch (e) { pg = require('/apps/unified/server/node_modules/pg'); }

const args = process.argv.slice(2);
const argv = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DAYS = String(Math.max(1, Math.min(180, Number(argv('--days', 30)) || 30)));
const SNAPD = String(Math.max(1, Math.min(60, Number(argv('--snap-days', 14)) || 14)));
/* Which business this run is about. segment.js is the single definition and this mirrors it exactly:
 * a rule belongs to Fixed if its segment column says so OR its key carries the fixed_ prefix. */
const SEG = (argv('--segment', 'fixed') || 'fixed').toLowerCase();
if (!['fixed', 'mvno', 'all'].includes(SEG)) { console.error(`✗ --segment must be fixed | mvno | all (got ${SEG})`); process.exit(1); }
const SEG_LABEL = SEG === 'fixed' ? 'Fixed' : SEG === 'mvno' ? 'Mobile (MVNO)' : 'Fixed + Mobile';
const segSql = (alias, keyCol) => SEG === 'all' ? 'TRUE'
  : SEG === 'fixed' ? `(${alias}.segment = 'fixed' OR ${alias}.${keyCol} LIKE 'fixed\\_%')`
  : `(${alias}.segment <> 'fixed' AND ${alias}.${keyCol} NOT LIKE 'fixed\\_%')`;
const FIXED_R = segSql('r', 'key');
const FIXED_A = segSql('a', 'rule_key');
/* snapshots belonging to this segment: the metrics its rules actually reference (the mvno metric keys
 * carry no prefix, so a LIKE on the metric name only works for Fixed) */
const SEG_METRICS = `metric_key IN (SELECT r.metric_key FROM alert_rules r WHERE ${FIXED_R})`;

const pad = (s, n) => { s = s == null ? '' : String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n); };
const rpad = (s, n) => String(s == null ? '' : s).padStart(n);
const pc = v => v == null ? '  — ' : (Number(v) * 100).toFixed(1).padStart(5) + '%';
const num = (v, d = 2) => v == null ? '—' : (Math.abs(Number(v)) < 1 && Number(v) !== 0 ? Number(v).toFixed(4) : Number(v).toFixed(d));
const iso = d => d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) : '—';
const hr = t => console.log('\n' + '='.repeat(118) + '\n' + t + '\n' + '='.repeat(118));

(async () => {
  const c = new pg.Client({ connectionString: URL });
  await c.connect();
  const q = (sql, p) => c.query(sql, p).then(r => r.rows);

  /* ---------- 0. context ---------- */
  hr(`0 · CONTEXT — ${SEG_LABEL} · unified_console on 172.31.15.121`);
  const ctx = (await q(`
    SELECT (SELECT count(*) FROM alert_rules r WHERE ${FIXED_R})::int AS rules,
           (SELECT count(*) FROM alert_rules r WHERE ${FIXED_R} AND r.enabled)::int AS enabled,
           (SELECT count(DISTINCT r.metric_key) FROM alert_rules r WHERE ${FIXED_R})::int AS metrics,
           (SELECT min(sim_now) FROM metric_snapshots WHERE ${SEG_METRICS}) AS snap_from,
           (SELECT max(sim_now) FROM metric_snapshots WHERE ${SEG_METRICS}) AS snap_to,
           (SELECT count(*) FROM metric_snapshots WHERE ${SEG_METRICS})::int AS snaps,
           (SELECT count(*) FROM alerts a WHERE ${FIXED_A})::int AS alerts_all,
           (SELECT count(*) FROM alerts a WHERE ${FIXED_A} AND a.status='open')::int AS open_now`))[0];
  console.log(`${SEG_LABEL} rules ${ctx.rules} (enabled ${ctx.enabled}) over ${ctx.metrics} metrics · alerts all-time ${ctx.alerts_all} · open now ${ctx.open_now}`);
  console.log(`metric_snapshots for this segment: ${ctx.snaps} rows, ${iso(ctx.snap_from)} → ${iso(ctx.snap_to)} UTC`);
  console.log(`census window: alerts ${DAYS} d · snapshots ${SNAPD} d`);

  /* ---------- 1. headline ---------- */
  hr(`1 · HEADLINE — what ${SEG_LABEL} fired, 7 d vs ${DAYS} d`);
  for (const d of ['7', DAYS]) {
    const t = (await q(`
      SELECT count(*)::int fires,
             count(*) FILTER (WHERE a.ack_at IS NOT NULL)::int acked,
             count(*) FILTER (WHERE a.status='resolved' AND a.ack_at IS NULL)::int untouched,
             count(*) FILTER (WHERE a.resolve_reason IN ('false_positive','single_customer','duplicate'))::int closed_noise,
             count(*) FILTER (WHERE (a.status='resolved' AND a.ack_at IS NULL)
                                 OR a.resolve_reason IN ('false_positive','single_customer','duplicate'))::int noise_any,
             count(*) FILTER (WHERE a.customers = 1)::int single_cust,
             count(*) FILTER (WHERE a.resolved_at IS NOT NULL AND a.resolved_at - a.fired_at < interval '15 min')::int lt15,
             coalesce(sum(a.reopen_count),0)::int reopens,
             count(DISTINCT a.rule_key)::int rules_firing,
             count(*) FILTER (WHERE a.severity='P1')::int p1,
             count(*) FILTER (WHERE a.severity='P2')::int p2
      FROM alerts a WHERE ${FIXED_A} AND a.fired_at >= now() - ($1||' days')::interval`, [d]))[0];
    const noise = t.noise_any;
    console.log(`${rpad(d + 'd', 4)} · fires ${rpad(t.fires, 5)} from ${rpad(t.rules_firing, 3)} rules · P1 ${rpad(t.p1, 4)} P2 ${rpad(t.p2, 4)} · acked ${rpad(t.acked, 4)} (${t.fires ? Math.round(100 * t.acked / t.fires) : 0}%)` +
      ` · untouched ${rpad(t.untouched, 4)} · closed-as-noise ${rpad(t.closed_noise, 3)} → NOISE ${t.fires ? Math.round(100 * noise / t.fires) : 0}%` +
      ` · single-customer ${rpad(t.single_cust, 4)} · <15min ${rpad(t.lt15, 4)} · reopens ${t.reopens}`);
  }

  /* ---------- 2. per-rule scorecard ---------- */
  hr(`2 · PER-RULE SCORECARD, ${DAYS} d — rules that actually fired, worst first`);
  console.log(pad('RULE KEY', 40) + pad('SEV', 4) + rpad('AGEd', 5) + rpad('FIRE', 5) + rpad('/DAY', 6) + rpad('ACK', 5) + rpad('UNTCH', 6) + rpad('FALSE', 6) + rpad('SNGL', 5) + rpad('DUP', 4) + rpad('REOP', 5) + rpad('<15m', 5) + rpad('MTTRm', 6) + rpad('NOISE%', 8) + pad('LAST FIRED', 14) + pad('VERDICT', 13) + 'CONDITION');
  const score = await q(`
    SELECT r.key, r.name, r.severity, r.enabled, r.metric_key, r.operator, r.threshold, r.window_hours, r.min_sample, r.dim, r.count_by, r.min_customers, r.created_at,
           count(a.id)::int fires,
           count(a.id) FILTER (WHERE a.ack_at IS NOT NULL)::int acked,
           count(a.id) FILTER (WHERE a.status='resolved' AND a.ack_at IS NULL)::int untouched,
           count(a.id) FILTER (WHERE (a.status='resolved' AND a.ack_at IS NULL)
                               OR a.resolve_reason IN ('false_positive','single_customer','duplicate'))::int noise_any,
           count(a.id) FILTER (WHERE a.resolve_reason='false_positive')::int false_positive,
           count(a.id) FILTER (WHERE a.resolve_reason='single_customer')::int closed_single,
           count(a.id) FILTER (WHERE a.resolve_reason='duplicate')::int duplicate,
           count(a.id) FILTER (WHERE a.customers = 1)::int single_customer,
           count(a.id) FILTER (WHERE a.customers IS NOT NULL)::int with_identity,
           count(a.id) FILTER (WHERE a.resolved_at IS NOT NULL AND a.resolved_at - a.fired_at < interval '15 min')::int lt15,
           coalesce(sum(a.reopen_count),0)::int reopens,
           round(avg(EXTRACT(EPOCH FROM (a.resolved_at - a.fired_at))/60) FILTER (WHERE a.resolved_at IS NOT NULL))::int mttr_min,
           max(a.fired_at) last_fired
    FROM alert_rules r LEFT JOIN alerts a ON a.rule_key = r.key AND a.fired_at >= now() - ($1||' days')::interval
    WHERE ${FIXED_R} GROUP BY r.id ORDER BY fires DESC, r.key`, [DAYS]);
  const fired = score.filter(r => r.fires > 0);
  for (const r of fired) {
    const share = r.fires ? Math.round(100 * r.noise_any / r.fires) : 0;
    const single = r.with_identity ? Math.round(100 * r.single_customer / r.with_identity) : null;
    const verdict = share >= 60 && r.fires >= 3 ? 'NOISY' : single != null && single >= 50 && r.fires >= 3 ? 'RETRY-STORMS'
      : r.acked === 0 && r.fires >= 5 ? 'IGNORED' : 'healthy';
    const cond = `${r.metric_key} ${r.operator} ${num(r.threshold)} · ${r.window_hours}h · n≥${r.min_sample}` +
      (Object.keys(r.dim || {}).length ? ' · ' + JSON.stringify(r.dim) : ' · dim {}') + (r.count_by !== 'events' ? ' · by ' + r.count_by : '');
    const ageD = Math.max(0.1, (Date.now() - new Date(r.created_at).getTime()) / 864e5);
    const perDay = (r.fires / Math.min(ageD, Number(DAYS))).toFixed(1);
    console.log(pad(r.key, 40) + pad(r.severity, 4) + rpad(ageD.toFixed(1), 5) + rpad(r.fires, 5) + rpad(perDay, 6) + rpad(r.acked, 5) + rpad(r.untouched, 6) + rpad(r.false_positive, 6) +
      rpad(r.single_customer, 5) + rpad(r.duplicate, 4) + rpad(r.reopens, 5) + rpad(r.lt15, 5) + rpad(r.mttr_min, 6) + rpad(share + '%', 8) + pad(iso(r.last_fired), 14) + pad(verdict, 13) + cond);
  }
  console.log(`\n${fired.length} of ${score.length} ${SEG_LABEL} rules fired in ${DAYS} d; ${score.length - fired.length} were silent.`);

  /* ---------- 3. threshold vs reality ---------- */
  hr(`3 · THRESHOLD vs REALITY — how often each enabled rule's CONDITION is already true (${SNAPD} d of snapshots)`);
  console.log('BREACH% is the share of ticks where the rule would fire. Anything above ~5% is a description of normal, not a detector.');
  console.log(pad('RULE KEY', 40) + pad('SEV', 4) + rpad('TICKS', 6) + rpad('BREACH', 7) + rpad('BREACH%', 8) + rpad('THRESH', 9) + rpad('p50', 9) + rpad('p90', 9) + rpad('p99', 9) + rpad('MAX', 9) + rpad('DIMS', 5));
  const thr = await q(`
    WITH r AS (SELECT r.key, r.severity, r.metric_key, r.operator, r.threshold, r.window_hours, r.min_sample, r.dim
               FROM alert_rules r WHERE ${FIXED_R} AND r.enabled)
    SELECT r.key, r.severity, r.threshold, count(m.id)::int ticks,
           count(m.id) FILTER (WHERE m.value IS NOT NULL AND m.sample >= r.min_sample AND
             CASE r.operator WHEN 'gte' THEN m.value >= r.threshold WHEN 'gt'  THEN m.value >  r.threshold
                             WHEN 'lte' THEN m.value <= r.threshold WHEN 'lt'  THEN m.value <  r.threshold
                             ELSE m.value = r.threshold END)::int breach,
           percentile_disc(0.5)  WITHIN GROUP (ORDER BY m.value) p50,
           percentile_disc(0.9)  WITHIN GROUP (ORDER BY m.value) p90,
           percentile_disc(0.99) WITHIN GROUP (ORDER BY m.value) p99,
           max(m.value) vmax, count(DISTINCT m.dim)::int dims
    FROM r LEFT JOIN metric_snapshots m
      ON m.metric_key = r.metric_key AND m.window_hours = r.window_hours AND m.dim @> r.dim
     AND m.sim_now >= now() - ($1||' days')::interval
    GROUP BY r.key, r.severity, r.threshold ORDER BY (CASE WHEN count(m.id)=0 THEN -1 ELSE count(m.id) FILTER (WHERE m.value IS NOT NULL AND m.sample >= r.min_sample AND
             CASE r.operator WHEN 'gte' THEN m.value >= r.threshold WHEN 'gt'  THEN m.value >  r.threshold
                             WHEN 'lte' THEN m.value <= r.threshold WHEN 'lt'  THEN m.value <  r.threshold
                             ELSE m.value = r.threshold END)::numeric / NULLIF(count(m.id),0) END) DESC NULLS LAST, r.key`, [SNAPD]);
  let noSnap = [];
  for (const r of thr) {
    if (!r.ticks) { noSnap.push(r.key); continue; }
    const share = r.breach / r.ticks;
    if (share < 0.02 && r.breach === 0) continue;
    console.log(pad(r.key, 40) + pad(r.severity, 4) + rpad(r.ticks, 6) + rpad(r.breach, 7) + rpad((share * 100).toFixed(1) + '%', 8) +
      rpad(num(r.threshold), 9) + rpad(num(r.p50), 9) + rpad(num(r.p90), 9) + rpad(num(r.p99), 9) + rpad(num(r.vmax), 9) + rpad(r.dims, 5));
  }
  const quietThr = thr.filter(r => r.ticks && r.breach === 0).length;
  console.log(`\n${quietThr} enabled rules never met their condition in ${SNAPD} d (not printed).`);
  if (noSnap.length) console.log(`\nNO SNAPSHOT DATA AT ALL (metric never computed for that window/dim — the rule cannot fire):\n  ${noSnap.join('\n  ')}`);

  /* ---------- 4. overlapping rules ---------- */
  hr('4 · OVERLAP — enabled rules watching the same metric + window + dim');
  const ov = await q(`
    SELECT r.metric_key, r.window_hours, r.dim::text dim,
           string_agg(r.key || ' [' || r.severity || ' ' || r.operator || ' ' || r.threshold || ' n≥' || r.min_sample || ']', E'\n      ' ORDER BY r.severity, r.threshold) rules,
           count(*)::int n
    FROM alert_rules r WHERE ${FIXED_R} AND r.enabled
    GROUP BY r.metric_key, r.window_hours, r.dim HAVING count(*) > 1 ORDER BY count(*) DESC, r.metric_key`);
  for (const o of ov) console.log(`\n  ${o.metric_key} · ${o.window_hours}h · ${o.dim}  (${o.n} rules)\n      ${o.rules}`);
  if (!ov.length) console.log('  none');

  /* ---------- 5. where the fires concentrate ---------- */
  hr(`5 · CONCENTRATION — which dim value produced the fires (${DAYS} d, rules with ≥3 fires)`);
  const conc = await q(`
    SELECT a.rule_key, a.dim::text dim, count(*)::int n,
           count(*) FILTER (WHERE a.ack_at IS NULL AND a.status='resolved')::int untouched
    FROM alerts a WHERE ${FIXED_A} AND a.fired_at >= now() - ($1||' days')::interval
      AND a.rule_key IN (SELECT rule_key FROM alerts a2 WHERE (a2.segment='fixed' OR a2.rule_key LIKE 'fixed\\_%')
                          AND a2.fired_at >= now() - ($1||' days')::interval GROUP BY rule_key HAVING count(*) >= 3)
    GROUP BY a.rule_key, a.dim ORDER BY a.rule_key, n DESC`, [DAYS]);
  let cur = null;
  for (const r of conc) {
    if (r.rule_key !== cur) { cur = r.rule_key; console.log(`\n  ${cur}`); }
    console.log(`      ${rpad(r.n, 5)} fires (${rpad(r.untouched, 4)} untouched)  ${r.dim}`);
  }
  if (!conc.length) console.log('  none');

  /* ---------- 6. flap ---------- */
  hr(`6 · FLAP — incidents that opened and closed again quickly (${DAYS} d)`);
  const flap = await q(`
    SELECT a.rule_key, count(*)::int fires,
           count(*) FILTER (WHERE a.resolved_at - a.fired_at < interval '15 min')::int lt15,
           count(*) FILTER (WHERE a.resolved_at - a.fired_at < interval '60 min')::int lt60,
           coalesce(sum(a.reopen_count),0)::int reopens,
           round(avg(EXTRACT(EPOCH FROM (a.resolved_at - a.fired_at))/60))::int avg_min
    FROM alerts a WHERE ${FIXED_A} AND a.fired_at >= now() - ($1||' days')::interval AND a.resolved_at IS NOT NULL
    GROUP BY a.rule_key HAVING count(*) >= 3 AND
      (count(*) FILTER (WHERE a.resolved_at - a.fired_at < interval '15 min')::numeric / count(*)) >= 0.4
    ORDER BY lt15 DESC`, [DAYS]);
  console.log(pad('RULE KEY', 40) + rpad('FIRES', 6) + rpad('<15m', 6) + rpad('<60m', 6) + rpad('REOPEN', 7) + rpad('AVG m', 6));
  for (const r of flap) console.log(pad(r.rule_key, 40) + rpad(r.fires, 6) + rpad(r.lt15, 6) + rpad(r.lt60, 6) + rpad(r.reopens, 7) + rpad(r.avg_min, 6));
  if (!flap.length) console.log('  no rule resolves under 15 min on 40%+ of its fires');

  /* ---------- 8. twin collapse ---------- */
  hr('8 · COLLAPSE — is each signal carrying exactly ONE incident?');
  console.log('After the 18 Sep runner change, rules sharing metric+window+dim share one incident. More than one');
  console.log('open incident on a signal means the collapse is not working.');
  const openSig = await q(`
    SELECT a.metric_key, a.window_hours, a.dim::text dim, count(*)::int n,
           string_agg(a.rule_key || ' [' || a.severity || ']', ', ' ORDER BY a.rule_key) keys,
           round(extract(epoch from (now() - min(a.fired_at)))/60)::int age_min,
           round(extract(epoch from (now() - max(a.last_seen_at)))/60)::int seen_min,
           count(*) FILTER (WHERE a.ack_at IS NOT NULL)::int acked,
           coalesce(sum(a.breach_count),0)::int breaches, coalesce(sum(a.reopen_count),0)::int reopens
      FROM alerts a WHERE ${FIXED_A} AND a.status='open'
     GROUP BY a.metric_key, a.window_hours, a.dim ORDER BY n DESC, a.metric_key`);
  const bad = openSig.filter(r => r.n > 1);
  console.log('\nLIVE = the condition was true within the clear-hold, so the incident is correctly open.');
  console.log('STALE = it has been quiet longer than the hold and should already have resolved — that is a bug, not a signal.\n');
  console.log('  ' + pad('SIGNAL', 38) + pad('DIM', 40) + rpad('AGEm', 7) + rpad('SEENm', 7) + rpad('BRCH', 6) + rpad('REOP', 7) + pad('ACK', 6) + 'STATE');
  const HOLD = 15;
  for (const r of openSig) {
    const state = r.seen_min > HOLD * 2 ? 'STALE?' : 'live';
    console.log(`  ${pad(r.metric_key, 38)}${pad(r.dim, 40)}${rpad(r.age_min, 7)}${rpad(r.seen_min, 7)}${rpad(r.breaches, 6)}${rpad(r.reopens, 7)}${pad(r.acked ? 'yes' : 'no', 6)}${state}${r.n > 1 ? '  ✗ ' + r.keys : ''}`);
  }
  const stale = openSig.filter(r => r.seen_min > HOLD * 2);
  console.log(stale.length ? `\n  ${stale.length} incident(s) quiet for over ${HOLD * 2} min and still open — investigate the resolve path.`
                           : `\n  every open incident saw its condition true within the last ${HOLD * 2} min: all correctly open.`);
  console.log(bad.length ? `\n  ✗ ${bad.length} signal(s) carrying more than one open incident — collapse NOT working.`
                         : `\n  ✓ every open signal carries exactly one incident.`);
  const dup = await q(`
    SELECT a.rule_key, count(*)::int n, max(a.resolved_at) last
      FROM alerts a WHERE ${FIXED_A} AND a.resolve_reason='duplicate' AND a.resolved_at >= now() - ($1||' days')::interval
     GROUP BY a.rule_key ORDER BY n DESC`, [DAYS]);
  console.log(`\n  twins closed as duplicate in ${DAYS} d: ${dup.length ? dup.map(d => `${d.rule_key} ×${d.n}`).join(', ') : 'none yet (they close on the first tick after a twin incident exists)'}`);
  const moves = await q(`
    SELECT c.body, c.created_at FROM incident_comments c
      JOIN alerts a ON a.id = c.alert_id
     WHERE ${FIXED_A} AND c.author='system' AND c.body LIKE 'Severity %'
       AND c.created_at >= now() - ($1||' days')::interval
     ORDER BY c.created_at DESC LIMIT 12`, [DAYS]);
  console.log(`  severity moves within a collapsed incident (newest ${moves.length}):`);
  for (const m of moves) console.log(`      ${iso(m.created_at)}  ${m.body}`);
  if (!moves.length) console.log('      none yet — a twin has to cross its second threshold first.');

  /* ---------- 9. time of day ---------- */
  hr(`9 · DAILY SHAPE — breach % by hour of day, KSA, for the rules that are open right now`);
  console.log('A flat threshold on a metric with a strong daily cycle is on every afternoon and off every night:');
  console.log('it becomes a dashboard, not an alert. This is the test. Bars are KSA 00..23; · none  ▁<5%  ▃<15%  ▅<30%  ▆<50%  █ more.');
  const openKeys = [...new Set(openSig.flatMap(r => String(r.keys).split(', ').map(k => k.replace(/ \[.*$/, ''))))];
  if (!openKeys.length) console.log('  nothing open.');
  else {
    const hours = await q(`
      WITH r AS (SELECT r.key, r.metric_key, r.operator, r.threshold, r.window_hours, r.min_sample, r.dim
                   FROM alert_rules r WHERE ${FIXED_R} AND r.key = ANY($2))
      SELECT r.key, extract(hour from (m.sim_now AT TIME ZONE 'Asia/Riyadh'))::int hh,
             count(m.id)::int ticks,
             count(m.id) FILTER (WHERE m.value IS NOT NULL AND m.sample >= r.min_sample AND
               CASE r.operator WHEN 'gte' THEN m.value >= r.threshold WHEN 'gt'  THEN m.value >  r.threshold
                               WHEN 'lte' THEN m.value <= r.threshold WHEN 'lt'  THEN m.value <  r.threshold
                               ELSE m.value = r.threshold END)::int breach
        FROM r JOIN metric_snapshots m
          ON m.metric_key = r.metric_key AND m.window_hours = r.window_hours AND m.dim @> r.dim
         AND m.sim_now >= now() - ($1||' days')::interval
       GROUP BY r.key, hh ORDER BY r.key, hh`, [SNAPD, openKeys]);
    const by = {};
    for (const h of hours) { (by[h.key] = by[h.key] || {})[h.hh] = h.ticks ? h.breach / h.ticks : 0; }
    const glyph = v => v === 0 ? '·' : v < 0.05 ? '▁' : v < 0.15 ? '▃' : v < 0.30 ? '▅' : v < 0.50 ? '▆' : '█';
    const ruler = Array.from({ length: 24 }, (_, i) => (i % 6 === 0 ? String(i).padStart(2, '0')[0] : i % 6 === 1 ? String(i).padStart(2, '0')[1] : ' ')).join('');
    console.log('  ' + pad('KSA hour', 40) + ruler + '   PEAK       DAY   NIGHT');
    console.log('  ' + pad('RULE', 40) + '─'.repeat(24));
    for (const k of Object.keys(by).sort()) {
      const h = by[k];
      const bars = Array.from({ length: 24 }, (_, i) => glyph(h[i] || 0)).join('');
      let peakH = 0, peakV = 0;
      for (let i = 0; i < 24; i++) if ((h[i] || 0) > peakV) { peakV = h[i]; peakH = i; }
      const mean = rs => { const v = rs.map(i => h[i] || 0); return v.reduce((a, b) => a + b, 0) / v.length; };
      const day = mean([9,10,11,12,13,14,15,16,17,18,19,20]), night = mean([0,1,2,3,4,5,6,7,23]);
      console.log('  ' + pad(k, 40) + bars + '  ' + rpad(String(peakH).padStart(2,'0') + 'h', 5) + rpad((peakV*100).toFixed(0)+'%', 5)
        + rpad((day*100).toFixed(0)+'%', 6) + rpad((night*100).toFixed(0)+'%', 6)
        + (night > 0 && day / Math.max(night, 0.001) >= 3 ? '  ← daily cycle' : night === 0 && day > 0.02 ? '  ← daytime only' : ''));
    }
  }

  /* ---------- 10. sample size behind the breaches ---------- */
  hr(`10 · SAMPLE SIZE — is the rule breaching because the platform moved, or because n was tiny?`);
  console.log('A p95 over 30 calls is interpolated from its top two values: one slow call moves it enormously.');
  console.log('If the median sample on BREACHING ticks is far below the median on all ticks, the rule is measuring');
  console.log('noise at low traffic, and min_sample is the fix — not the threshold.');
  console.log('  ' + pad('RULE', 40) + rpad('MIN_N', 7) + rpad('n p50', 8) + rpad('n p50', 8) + rpad('n min', 8) + rpad('BREACH', 8) + '  VERDICT');
  console.log('  ' + pad('', 40) + rpad('set', 7) + rpad('all', 8) + rpad('breach', 8) + rpad('breach', 8) + rpad('ticks', 8));
  const samp = await q(`
    WITH r AS (SELECT r.key, r.metric_key, r.operator, r.threshold, r.window_hours, r.min_sample, r.dim
                 FROM alert_rules r WHERE ${FIXED_R} AND r.enabled),
    s AS (SELECT r.key, r.min_sample, m.sample,
                 (m.value IS NOT NULL AND m.sample >= r.min_sample AND
                  CASE r.operator WHEN 'gte' THEN m.value >= r.threshold WHEN 'gt'  THEN m.value >  r.threshold
                                  WHEN 'lte' THEN m.value <= r.threshold WHEN 'lt'  THEN m.value <  r.threshold
                                  ELSE m.value = r.threshold END) AS br
            FROM r JOIN metric_snapshots m
              ON m.metric_key = r.metric_key AND m.window_hours = r.window_hours AND m.dim @> r.dim
             AND m.sim_now >= now() - ($1||' days')::interval)
    SELECT key, min_sample,
           percentile_disc(0.5) WITHIN GROUP (ORDER BY sample)::int p50_all,
           (percentile_disc(0.5) WITHIN GROUP (ORDER BY sample) FILTER (WHERE br))::int p50_br,
           (min(sample) FILTER (WHERE br))::int min_br,
           count(*) FILTER (WHERE br)::int breach, count(*)::int ticks
      FROM s GROUP BY key, min_sample HAVING count(*) FILTER (WHERE br) > 0
     ORDER BY (percentile_disc(0.5) WITHIN GROUP (ORDER BY sample) FILTER (WHERE br))::numeric
              / NULLIF(percentile_disc(0.5) WITHIN GROUP (ORDER BY sample), 0) ASC NULLS LAST`, [SNAPD]);
  for (const r of samp) {
    const ratio = r.p50_all ? r.p50_br / r.p50_all : null;
    const verdict = ratio == null ? ''
      : ratio <= 0.5 ? `small-sample noise — breaches at ${Math.round(ratio * 100)}% of normal traffic`
      : ratio <= 0.8 ? 'leans low-traffic'
      : ratio >= 1.5 ? 'breaches under HEAVY load — real' : 'sample-independent — real';
    console.log('  ' + pad(r.key, 40) + rpad(r.min_sample, 7) + rpad(r.p50_all, 8) + rpad(r.p50_br, 8) +
      rpad(r.min_br, 8) + rpad(r.breach, 8) + '  ' + verdict);
  }
  if (!samp.length) console.log('  no rule breached in the window.');

  /* ---------- 11. alerts with no rule behind them ---------- */
  hr(`11 · UNGOVERNED — alerts whose rule_key has no row in alert_rules (${DAYS} d)`);
  console.log('These cannot be opened, tuned or disabled from the Alert rules tab, and the rule scorecard in');
  console.log('section 2 cannot see them at all because it joins from alert_rules. They still page people.');
  const orphan = await q(`
    SELECT a.rule_key, count(*)::int fires, count(*) FILTER (WHERE a.ack_at IS NOT NULL)::int acked,
           count(*) FILTER (WHERE a.status='resolved' AND a.ack_at IS NULL)::int untouched,
           count(*) FILTER (WHERE a.status='open')::int open_now,
           min(a.severity) sev, max(a.fired_at) last_fired
      FROM alerts a
     WHERE ${FIXED_A} AND a.fired_at >= now() - ($1||' days')::interval
       AND NOT EXISTS (SELECT 1 FROM alert_rules r WHERE r.key = a.rule_key)
     GROUP BY a.rule_key ORDER BY fires DESC`, [DAYS]);
  if (!orphan.length) console.log('  none — every alert traces back to a rule.');
  else {
    console.log('  ' + pad('RULE KEY', 40) + pad('SEV', 5) + rpad('FIRES', 7) + rpad('ACK', 6) + rpad('UNTCH', 7) + rpad('OPEN', 7) + 'LAST FIRED');
    let tot = 0, unt = 0;
    for (const o of orphan) { tot += o.fires; unt += o.untouched;
      console.log('  ' + pad(o.rule_key, 40) + pad(o.sev, 5) + rpad(o.fires, 7) + rpad(o.acked, 6) + rpad(o.untouched, 7) + rpad(o.open_now, 7) + iso(o.last_fired)); }
    console.log(`\n  ${orphan.length} ungoverned source(s), ${tot} fires, ${unt} of them never acknowledged.`);
  }

  /* ---------- 12. operator edits ---------- */
  hr('12 · OPERATOR EDITS — rules changed in the console (the seed no longer applies their numbers) and disabled rules');
  const ed = await q(`SELECT r.key, r.severity, r.enabled, r.operator_edited, r.operator, r.threshold, r.min_sample, r.window_hours
                        FROM alert_rules r WHERE ${FIXED_R} AND (r.operator_edited OR NOT r.enabled) ORDER BY r.enabled, r.key`).catch(() => []);
  for (const r of ed) console.log('  ' + pad(r.key, 44) + pad(r.severity, 4) + pad(r.enabled ? 'on' : 'OFF', 5) + pad(r.operator_edited ? 'edited' : '', 8) + `${r.operator} ${num(r.threshold)} · n≥${r.min_sample} · ${r.window_hours}h`);
  if (!ed.length) console.log('  none');

  /* ---------- 13. step latency ---------- */
  hr(`13 · STEP LATENCY — app steps by p95 (${SNAPD} d, ≥ 20 calls): which steps are slow every day`);
  console.log('A step that is slow every day is a known problem (a problem record), not an incident: it must not decide the channel latency.');
  console.log('  ' + pad('CHANNEL', 10) + pad('STEP', 52) + rpad('CALLS', 7) + rpad('SHARE', 7) + rpad('FAIL%', 7) + rpad('p50 ms', 9) + rpad('p95 ms', 9) + rpad('p99 ms', 9) + rpad('≥10s', 6) + rpad('DAYS≥10s', 9));
  const steps = await q(`
    WITH s AS (SELECT coalesce(channel,'other') ch, path, ok, duration_ms, date(ts AT TIME ZONE 'Asia/Riyadh') d
                 FROM fixed_app_events WHERE kind='mutation' AND duration_ms IS NOT NULL AND ts >= now() - ($1||' days')::interval),
         dd AS (SELECT ch, path, d, percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) p95d FROM s GROUP BY 1,2,3 HAVING count(*) >= 5)
    SELECT s.ch, s.path, count(*)::int n, round(100.0 * count(*) / sum(count(*)) OVER (PARTITION BY s.ch), 1) share,
           round(100.0 * count(*) FILTER (WHERE ok IS FALSE) / count(*), 1) failp,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms))::int p50, round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::int p95,
           round(percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms))::int p99, count(*) FILTER (WHERE duration_ms >= 10000)::int over10,
           (SELECT count(*) FROM dd WHERE dd.ch = s.ch AND dd.path = s.path AND dd.p95d >= 10000)::int days10, (SELECT count(*) FROM dd WHERE dd.ch = s.ch AND dd.path = s.path)::int days
      FROM s GROUP BY s.ch, s.path HAVING count(*) >= 20 ORDER BY p95 DESC LIMIT 30`, [SNAPD]);
  for (const r of steps) console.log('  ' + pad(r.ch, 10) + pad(r.path, 52) + rpad(r.n, 7) + rpad(r.share + '%', 7) + rpad(r.failp + '%', 7) + rpad(r.p50, 9) + rpad(r.p95, 9) + rpad(r.p99, 9) + rpad(r.over10, 6) + rpad(`${r.days10}/${r.days}`, 9));

  /* ---------- 14. classification audit ---------- */
  hr(`14 · CLASSIFICATION — failed app steps counted TECHNICAL whose own error line says BUSINESS (${SNAPD} d)`);
  console.log('The app log writes two lines for a refused step: "mutation <step> fail Nms" (no reason) and the error line (status + reason).');
  console.log('The rate rules count the first one, classed technical by default. PAIRED = the error line with the same request id says business.');
  const cls = await q(`
    WITH m AS (SELECT id, ts, coalesce(channel,'other') ch, path, request_id, reason_class FROM fixed_app_events
                WHERE kind='mutation' AND ok IS FALSE AND ts >= now() - ($1||' days')::interval),
         e AS (SELECT request_id, path, ts, reason_class, status_code, left(reason, 70) reason FROM fixed_app_events
                WHERE kind <> 'mutation' AND ok IS FALSE AND request_id IS NOT NULL AND ts >= now() - ($1||' days')::interval - interval '5 minutes'),
         p AS (SELECT DISTINCT ON (m.id) m.id, m.ch, m.path, m.reason_class mc, e.reason_class ec, e.status_code, e.reason
                 FROM m LEFT JOIN e ON e.request_id = m.request_id AND (e.path = m.path OR e.path IS NULL) AND e.ts BETWEEN m.ts - interval '2 minutes' AND m.ts + interval '2 minutes'
                ORDER BY m.id, CASE e.reason_class WHEN 'technical' THEN 0 WHEN 'business' THEN 1 WHEN 'client' THEN 2 ELSE 3 END)
    SELECT ch, path, count(*)::int fails, count(*) FILTER (WHERE mc='technical')::int tech_now,
           count(*) FILTER (WHERE mc='technical' AND ec='business')::int to_business, count(*) FILTER (WHERE mc='technical' AND ec='client')::int to_client,
           count(*) FILTER (WHERE mc='technical' AND ec='technical')::int stays_tech, count(*) FILTER (WHERE mc='technical' AND ec IS NULL)::int unpaired,
           (array_agg(coalesce(status_code::text,'-') || ' ' || reason) FILTER (WHERE ec='business'))[1] sample
      FROM p GROUP BY 1,2 HAVING count(*) FILTER (WHERE mc='technical') >= 10 ORDER BY tech_now DESC LIMIT 30`, [SNAPD]);
  console.log('  ' + pad('CHANNEL', 10) + pad('STEP', 46) + rpad('FAILS', 7) + rpad('TECH', 7) + rpad('→BIZ', 7) + rpad('→CLI', 6) + rpad('TECH✓', 7) + rpad('UNPAIR', 8) + '  SAMPLE BUSINESS REASON');
  let T = { tech: 0, biz: 0, cli: 0 };
  for (const r of cls) { T.tech += r.tech_now; T.biz += r.to_business; T.cli += r.to_client;
    console.log('  ' + pad(r.ch, 10) + pad(r.path, 46) + rpad(r.fails, 7) + rpad(r.tech_now, 7) + rpad(r.to_business, 7) + rpad(r.to_client, 6) + rpad(r.stays_tech, 7) + rpad(r.unpaired, 8) + '  ' + (r.sample || '')); }
  console.log(`\n  listed steps: ${T.tech} technical failures today, ${T.biz} are business refusals and ${T.cli} client errors by their own error line (${T.tech ? Math.round(100 * (T.biz + T.cli) / T.tech) : 0}% misclassified).`);

  /* ---------- 15. what the rates and latencies become ---------- */
  hr(`15 · BEFORE / AFTER — hourly technical failure rate and step latency p95 per channel (${SNAPD} d, hours with ≥ 20 steps)`);
  console.log('BEFORE = as counted today. AFTER = a failed step takes the class of its own error line; latency without the steps slow every day');
  console.log('(p50 ≥ 8 s over the window). These are the distributions the new thresholds are set from: P2 ≈ p95, P1 ≈ p99 of AFTER.');
  const ba = await q(`
    WITH slow AS (SELECT path FROM fixed_app_events WHERE kind='mutation' AND duration_ms IS NOT NULL AND ts >= now() - ($1||' days')::interval
                   GROUP BY path HAVING count(*) >= 20 AND percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) >= 8000),
         m AS (SELECT id, ts, coalesce(channel,'other') ch, path, request_id, ok, reason_class, duration_ms FROM fixed_app_events
                WHERE kind='mutation' AND ts >= now() - ($1||' days')::interval AND coalesce(channel,'other') IN ('sda','web','salamhome')),
         e AS (SELECT request_id, path, ts, reason_class FROM fixed_app_events
                WHERE kind <> 'mutation' AND ok IS FALSE AND request_id IS NOT NULL AND ts >= now() - ($1||' days')::interval - interval '5 minutes'),
         c AS (SELECT DISTINCT ON (m.id) m.*, CASE WHEN m.ok IS FALSE AND m.reason_class='technical' AND e.reason_class IN ('business','client') THEN e.reason_class ELSE m.reason_class END rc2
                 FROM m LEFT JOIN e ON m.ok IS FALSE AND e.request_id = m.request_id AND (e.path = m.path OR e.path IS NULL) AND e.ts BETWEEN m.ts - interval '2 minutes' AND m.ts + interval '2 minutes'
                ORDER BY m.id, CASE e.reason_class WHEN 'technical' THEN 0 WHEN 'business' THEN 1 WHEN 'client' THEN 2 ELSE 3 END),
         h AS (SELECT ch, date_trunc('hour', ts) hh, count(*) n,
                      count(*) FILTER (WHERE ok IS FALSE AND reason_class='technical')::numeric / count(*) tb,
                      count(*) FILTER (WHERE ok IS FALSE AND rc2='technical')::numeric / count(*) ta,
                      percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) lb,
                      percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE path NOT IN (SELECT path FROM slow)) la,
                      count(duration_ms) FILTER (WHERE path NOT IN (SELECT path FROM slow)) nla
                 FROM c GROUP BY 1,2 HAVING count(*) >= 20)
    SELECT ch, count(*)::int hours, percentile_cont(0.5) WITHIN GROUP (ORDER BY n)::int n50,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY tb) tb50, percentile_cont(0.95) WITHIN GROUP (ORDER BY tb) tb95, percentile_cont(0.99) WITHIN GROUP (ORDER BY tb) tb99,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY ta) ta50, percentile_cont(0.95) WITHIN GROUP (ORDER BY ta) ta95, percentile_cont(0.99) WITHIN GROUP (ORDER BY ta) ta99,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY lb) lb50, percentile_cont(0.95) WITHIN GROUP (ORDER BY lb) lb95, percentile_cont(0.99) WITHIN GROUP (ORDER BY lb) lb99,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY la) la50, percentile_cont(0.95) WITHIN GROUP (ORDER BY la) la95, percentile_cont(0.99) WITHIN GROUP (ORDER BY la) la99,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY la) FILTER (WHERE nla >= 60) la95n60, percentile_cont(0.99) WITHIN GROUP (ORDER BY la) FILTER (WHERE nla >= 60) la99n60,
           (SELECT string_agg(path, ', ') FROM slow) slow
      FROM h GROUP BY ch ORDER BY ch`, [SNAPD]);
  console.log('  ' + pad('CHANNEL', 10) + rpad('HOURS', 6) + rpad('n p50', 7) + ' │ TECH RATE before p50/p95/p99 │ after p50/p95/p99    │ LATENCY p95 ms before p50/p95/p99 │ after p50/p95/p99 │ after n≥60 p95/p99');
  const f = v => v == null ? '—' : (Number(v) * 100).toFixed(1) + '%', ms = v => v == null ? '—' : String(Math.round(v));
  for (const r of ba) console.log('  ' + pad(r.ch, 10) + rpad(r.hours, 6) + rpad(r.n50, 7) + ` │ ${f(r.tb50)} / ${f(r.tb95)} / ${f(r.tb99)} │ ${f(r.ta50)} / ${f(r.ta95)} / ${f(r.ta99)} │ ${ms(r.lb50)} / ${ms(r.lb95)} / ${ms(r.lb99)} │ ${ms(r.la50)} / ${ms(r.la95)} / ${ms(r.la99)} │ ${ms(r.la95n60)} / ${ms(r.la99n60)}`);
  if (ba[0]) console.log(`\n  steps left out of the AFTER latency (p50 ≥ 8 s): ${ba[0].slow || 'none'}`);

  /* ---------- 16. open incidents ---------- */
  hr('16 · OPEN NOW — every open Fixed incident, how long, owner');
  const opn = await q(`SELECT a.id, a.rule_key, a.severity, a.name, round(extract(epoch from now() - a.fired_at)/3600, 1) hours, a.ack_at IS NOT NULL acked, coalesce(a.assignee, a.ack_by) owner, a.observed_value, a.sample
                         FROM alerts a WHERE ${FIXED_A} AND a.status='open' ORDER BY a.severity, a.fired_at`).catch(e => { console.log('  ' + e.message); return []; });
  for (const r of opn) console.log('  ' + pad(r.id, 7) + pad(r.severity, 4) + pad(r.rule_key, 44) + rpad(r.hours + ' h', 9) + pad(r.acked ? ' acked' : ' NOT acked', 11) + pad(r.owner || '', 22) + `value ${num(r.observed_value)} n=${r.sample}`);
  if (!opn.length) console.log('  none');

  /* ---------- 17. simulation of the CURRENT rules on the raw events ---------- */
  hr(`17 · SIMULATION — the rules as they are NOW, replayed hour by hour on the raw app log (${SNAPD} d, current classification)`);
  console.log('Hourly buckets stand in for the rolling 60-min tick. EPISODES = runs of breaching hours, two runs ≤ 1 h apart counted once');
  console.log('(the 60-min re-open stitches them into one incident) — the closest thing to "incidents it would have opened".');
  console.log('FIRES 30d = what the rule actually fired in the last 30 days (old thresholds / old classification until this release).');
  const SLOW = ['salamApp.user.createTicket', 'ePurchase.actions.confirmOtp'];       // = fixedChannelMetrics.SLOW_STEPS
  const simRules = await q(`SELECT r.key, r.severity, r.metric_key, r.threshold, r.min_sample, r.dim, r.enabled,
        (SELECT count(*) FROM alerts a WHERE a.rule_key = r.key AND a.fired_at >= now() - interval '30 days')::int fires30
      FROM alert_rules r WHERE ${FIXED_R} AND r.metric_key IN ('fixed_applog_fail_rate','fixed_applog_latency_p95_ms','fixed_applog_slow_step_p95_ms') ORDER BY r.metric_key, r.dim::text, r.threshold`);
  const hrs = await q(`SELECT coalesce(channel,'other') ch, date_trunc('hour', ts) hh, count(*)::int n,
        count(*) FILTER (WHERE ok IS FALSE AND reason_class='technical')::int tech, count(*) FILTER (WHERE ok IS FALSE AND reason_class='business')::int biz,
        count(duration_ms) FILTER (WHERE coalesce(path,'') <> ALL($2::text[]))::int nl,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE coalesce(path,'') <> ALL($2::text[])) p95
      FROM fixed_app_events WHERE kind='mutation' AND ts >= now() - ($1||' days')::interval AND coalesce(channel,'other') IN ('sda','web','salamhome')
      GROUP BY 1,2
      UNION ALL
      SELECT 'all', date_trunc('hour', ts), count(*)::int, count(*) FILTER (WHERE ok IS FALSE AND reason_class='technical')::int, count(*) FILTER (WHERE ok IS FALSE AND reason_class='business')::int,
        count(duration_ms) FILTER (WHERE coalesce(path,'') <> ALL($2::text[]))::int,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE coalesce(path,'') <> ALL($2::text[]))
      FROM fixed_app_events WHERE kind='mutation' AND ts >= now() - ($1||' days')::interval AND coalesce(channel,'other') IN ('sda','web','salamhome') GROUP BY 2`, [SNAPD, SLOW]);
  const slowH = await q(`WITH g AS (SELECT generate_series(date_trunc('hour', now() - ($1||' days')::interval), date_trunc('hour', now()), interval '1 hour') hh)
      SELECT p.path, g.hh, count(e.*)::int n, percentile_cont(0.95) WITHIN GROUP (ORDER BY e.duration_ms) p95
        FROM g CROSS JOIN unnest($2::text[]) AS p(path)
        LEFT JOIN fixed_app_events e ON e.kind='mutation' AND e.path = p.path AND e.duration_ms IS NOT NULL AND e.ts >= g.hh - interval '2 hours' AND e.ts < g.hh + interval '1 hour'
       GROUP BY 1,2`, [SNAPD, SLOW]);
  const episodes = list => { const t = list.map(x => new Date(x).getTime()).sort((a, b) => a - b); let n = 0, last = -1e15; for (const v of t) { if (v - last > 2 * 3600e3) n++; last = v; } return n; };
  console.log('  ' + pad('RULE', 42) + pad('SEV', 4) + rpad('THRESH', 9) + rpad('n≥', 5) + rpad('HOURS', 7) + rpad('BREACH h', 9) + rpad('%', 7) + rpad('EPISODES', 9) + rpad('/WEEK', 7) + rpad('FIRES 30d', 10) + '  STATE');
  let totEp = 0, totOld = 0;
  for (const r of simRules) {
    const d = r.dim || {}; let rows = [], hit = [];
    if (r.metric_key === 'fixed_applog_slow_step_p95_ms') { rows = slowH.filter(x => x.path === d.path); hit = rows.filter(x => x.n >= r.min_sample && x.p95 >= Number(r.threshold)); }
    else if (r.metric_key === 'fixed_applog_latency_p95_ms') { rows = hrs.filter(x => x.ch === d.channel); hit = rows.filter(x => x.nl >= r.min_sample && x.p95 != null && x.p95 >= Number(r.threshold)); }
    else { rows = hrs.filter(x => x.ch === d.channel); const k = d.cls === 'business' ? 'biz' : 'tech'; hit = rows.filter(x => x.n >= r.min_sample && x[k] / x.n >= Number(r.threshold)); }
    const ep = episodes(hit.map(x => x.hh)); if (r.enabled) totEp += ep; totOld += r.fires30;
    console.log('  ' + pad(r.key, 42) + pad(r.severity, 4) + rpad(num(r.threshold), 9) + rpad(r.min_sample, 5) + rpad(rows.length, 7) + rpad(hit.length, 9) + rpad(rows.length ? (100 * hit.length / rows.length).toFixed(1) : '—', 7) +
      rpad(ep, 9) + rpad((ep * 7 / Number(SNAPD)).toFixed(1), 7) + rpad(r.fires30, 10) + '  ' + (r.enabled ? '' : 'disabled'));
  }
  console.log(`\n  these ${simRules.length} rules: ${totOld} actual fires in 30 d before → about ${Math.round(totEp * 30 / Number(SNAPD))} incidents per 30 d at the current thresholds on the current classification.`);
  console.log('  Not simulated here (their metric needs its own baseline): the anomaly z-scores, the board and integration-host rules — read them in section 3 after a week.');

  /* ---------- 7. silent rules ---------- */
  hr(`7 · SILENT — enabled ${SEG_LABEL} rules with zero fires in ${DAYS} d`);
  const silent = score.filter(r => r.fires === 0 && r.enabled);
  console.log(silent.map(r => r.key).join('  ') || '  none');
  console.log(`\n${silent.length} enabled rules never fired. Disabled rules: ${score.filter(r => !r.enabled).length}.`);

  await c.end();
  console.log('\nDone. READ-ONLY — nothing was written.');
})().catch(e => { console.error('✗', e.message); process.exit(1); });
