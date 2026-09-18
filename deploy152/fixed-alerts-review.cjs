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
 *   cd /apps/unified/server && node /tmp/fixed-alerts-review.cjs --days 30
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
const FIXED_R = `(r.segment = 'fixed' OR r.key LIKE 'fixed\\_%')`;
const FIXED_A = `(a.segment = 'fixed' OR a.rule_key LIKE 'fixed\\_%')`;

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
  hr('0 · CONTEXT — unified_console on 172.31.15.121');
  const ctx = (await q(`
    SELECT (SELECT count(*) FROM alert_rules r WHERE ${FIXED_R})::int AS rules,
           (SELECT count(*) FROM alert_rules r WHERE ${FIXED_R} AND r.enabled)::int AS enabled,
           (SELECT count(DISTINCT r.metric_key) FROM alert_rules r WHERE ${FIXED_R})::int AS metrics,
           (SELECT min(sim_now) FROM metric_snapshots WHERE metric_key LIKE 'fixed\\_%') AS snap_from,
           (SELECT max(sim_now) FROM metric_snapshots WHERE metric_key LIKE 'fixed\\_%') AS snap_to,
           (SELECT count(*) FROM metric_snapshots WHERE metric_key LIKE 'fixed\\_%')::int AS snaps,
           (SELECT count(*) FROM alerts a WHERE ${FIXED_A})::int AS alerts_all,
           (SELECT count(*) FROM alerts a WHERE ${FIXED_A} AND a.status='open')::int AS open_now`))[0];
  console.log(`rules ${ctx.rules} (enabled ${ctx.enabled}) over ${ctx.metrics} metrics · alerts all-time ${ctx.alerts_all} · open now ${ctx.open_now}`);
  console.log(`metric_snapshots for fixed_*: ${ctx.snaps} rows, ${iso(ctx.snap_from)} → ${iso(ctx.snap_to)} UTC`);
  console.log(`census window: alerts ${DAYS} d · snapshots ${SNAPD} d`);

  /* ---------- 1. headline ---------- */
  hr(`1 · HEADLINE — what Fixed fired, 7 d vs ${DAYS} d`);
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
  console.log(pad('RULE KEY', 40) + pad('SEV', 4) + rpad('AGEd', 5) + rpad('FIRE', 5) + rpad('/DAY', 6) + rpad('ACK', 5) + rpad('UNTCH', 6) + rpad('FALSE', 6) + rpad('SNGL', 5) + rpad('DUP', 4) + rpad('REOP', 5) + rpad('<15m', 5) + rpad('MTTRm', 6) + rpad('NOISE%', 7) + '  ' + pad('VERDICT', 13) + 'CONDITION');
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
      rpad(r.single_customer, 5) + rpad(r.duplicate, 4) + rpad(r.reopens, 5) + rpad(r.lt15, 5) + rpad(r.mttr_min, 6) + rpad(share + '%', 7) + '  ' + pad(verdict, 13) + cond);
  }
  console.log(`\n${fired.length} of ${score.length} Fixed rules fired in ${DAYS} d; ${score.length - fired.length} were silent.`);

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

  /* ---------- 7. silent rules ---------- */
  hr(`7 · SILENT — enabled Fixed rules with zero fires in ${DAYS} d`);
  const silent = score.filter(r => r.fires === 0 && r.enabled);
  console.log(silent.map(r => r.key).join('  ') || '  none');
  console.log(`\n${silent.length} enabled rules never fired. Disabled rules: ${score.filter(r => !r.enabled).length}.`);

  await c.end();
  console.log('\nDone. READ-ONLY — nothing was written.');
})().catch(e => { console.error('✗', e.message); process.exit(1); });
