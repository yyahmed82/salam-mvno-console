/* alertEvidence.js — WHO AND WHAT IS BEHIND AN INCIDENT (TKT-000065, 24 Sep 2026).
 *
 * The affected items of one incident, computed live over its window [fired_at − window_hours, last_seen_at]:
 *   · Fixed order rules (fixed_nafath_*, fixed_semati_*, fixed_timeout_*, fixed_conversion_*, …) → order attempts from the
 *     dealer-ops read model (sda_ops / B2C): order number, customer (masked), workflow, step reached, last error, dealer /
 *     channel, and the LAST FAILING API CALL of each attempt (endpoint · status · error) from api_calls; the request and
 *     response bodies of that attempt are one more call away (trace) — bodies are masked at rest by the ingest.
 *   · Fixed app-log rules (fixed_applog_*, fixed_yakeen_*) → fixed_app_events: endpoint (path), status code, reason, message,
 *     request id / state id, platform.
 *   · Mobile rules → api_traffic_events of the metric family (or the exact API the rule names): endpoint, code, message,
 *     transaction id — the request/response of a transaction comes from the existing trace view.
 * Identifiers are cut to their last digits unless the caller holds unmaskPII AND asks (?unmask=1) — audited by the route.
 * Read-only, bounded (LIMIT), never throws to the caller: a missing pool becomes a note. Used by GET /api/alerts/:id/evidence
 * (incident drawer) and by alertReport.js (mail + PDF columns). */
'use strict';
const db = require('./db');
const f360 = require('./fixed360');

const tail = (s, k) => s == null || s === '' ? null : '…' + String(s).slice(-k);
const maskRow = r => ({ ...r, msisdn: tail(r.msisdn, 4), customer_id: tail(r.customer_id, 4), cust_code: tail(r.cust_code, 4), service_no: tail(r.service_no, 6), iccid: tail(r.iccid, 6) });
const isFixedKey = k => /^fixed_/.test(String(k || ''));
const isAppLog = k => /^fixed_(applog|yakeen)/.test(String(k || ''));

function windowOf(a) {
  const h = Math.max(1, Number(a.window_hours) || 1);
  const fired = new Date(a.fired_at); const last = new Date(a.last_seen_at || a.fired_at);
  const from = new Date(fired.getTime() - h * 3600e3);
  const to = a.status === 'open' ? new Date() : new Date(Math.max(last.getTime(), fired.getTime()) + 5 * 60e3);
  return { from, to, hours: h };
}

/* which attempts a Fixed order rule is about — mirrors alertReport.fixedEvidence */
function attemptPredicate(key) {
  const FIVE_G = ['fiveGWhiteLabel', 'fiveGFWA'];
  if (/nafath/.test(key)) return { sql: `AND oa.workflow::text = ANY($3::text[]) AND oa.nafath_outcome IS NOT NULL AND oa.nafath_outcome <> 'COMPLETED'`, params: [FIVE_G], title: 'attempts whose Nafath outcome is not COMPLETED' };
  if (/semati/.test(key)) return { sql: `AND oa.workflow::text = ANY($3::text[]) AND oa.nafath_outcome IN ('FAILED','MOBILE_EXISTS')`, params: [FIVE_G], title: 'attempts that failed at Semati provisioning' };
  if (/manafith/.test(key)) return { sql: `AND oa.dealer_validation IS NOT NULL AND oa.dealer_validation NOT IN ('OK','PASSED','APPROVED')`, params: [], title: 'attempts denied by Manafith dealer validation' };
  if (/timeout/.test(key)) return { sql: `AND (oa.outcome::text IN ('STALLED','EXPIRED') OR oa.last_error_category ILIKE '%timeout%')`, params: [], title: 'attempts that timed out or stalled' };
  if (/conversion|stagnation|offhours|workhours/.test(key)) return { sql: `AND oa.outcome::text <> 'COMPLETED'`, params: [], title: 'attempts not completed in the window' };
  return { sql: `AND (oa.outcome::text IN ('STALLED','CANCELLED','EXPIRED') OR oa.last_error_category IS NOT NULL)`, params: [], title: 'attempts with an error in the window' };
}

async function fixedAttempts(a, { limit, unmask, channel }) {
  const pool = f360.poolFor(channel); if (!pool) return { kind: 'attempts', rows: [], note: 'OPS_DATABASE_URL not configured on this console' };
  const w = windowOf(a); const pred = attemptPredicate(a.rule_key);
  const P = [w.from.toISOString(), w.to.toISOString(), ...pred.params];
  if (channel) { P.push(channel); }
  const chanSql = channel ? `AND oa.channel = $${P.length}` : '';
  P.push(limit);
  const r = await pool.query(
    `SELECT oa.id, oa.started_at, oa.completed_at, oa.workflow::text AS workflow, oa.plan, oa.channel, oa.referral_code, oa.order_number, oa.odb,
            oa.msisdn, oa.customer_id, oa.cust_code, oa.service_no, oa.iccid, oa.outcome::text AS outcome, oa.step_reached, oa.nafath_outcome,
            oa.dealer_validation, oa.last_error_category, oa.last_error_at, COALESCE(oa.region, d.region) AS region,
            COALESCE(d.dealer_name, d.dealer_code, oa.channel) AS dealer, d.staff_name,
            c.endpoint AS call_endpoint, c.method AS call_method, c.status AS call_status, c.error_class AS call_error_class, c.error_msg AS call_error_msg, c.id AS call_id, c.created_at AS call_at
       FROM order_attempts oa LEFT JOIN dealers d ON d.id = oa.dealer_id
       LEFT JOIN LATERAL (SELECT id, method, endpoint, status, error_class, error_msg, created_at FROM api_calls
                            WHERE attempt_id = oa.id AND (COALESCE(NULLIF(regexp_replace(status::text, '\\D', '', 'g'), '')::int, 0) >= 400 OR error_class IS NOT NULL OR error_msg IS NOT NULL)
                            ORDER BY created_at DESC LIMIT 1) c ON true
      WHERE oa.started_at >= $1 AND oa.started_at < $2 ${pred.sql} ${chanSql}
      ORDER BY COALESCE(oa.last_error_at, oa.started_at) DESC LIMIT $${P.length}`, P);
  const rows = r.rows.map(x => unmask ? x : maskRow(x));
  return { kind: 'attempts', title: pred.title, window: w, rows, source: pool === db.opsBeta ? 'sda_ops.beta' : 'sda_ops', unmasked: !!unmask,
    cols: ['Started (KSA)', 'Order · customer', 'Journey · step', 'Last failing call', 'Outcome · error', 'Dealer / channel'] };
}

async function fixedAppLog(a, { limit }) {
  const w = windowOf(a); const key = String(a.rule_key || '');
  const kindSql = /yakeen/.test(key) ? `AND kind ILIKE '%yakeen%'` : '';
  const r = await db.console.query(
    `SELECT id, ts, host, channel, source, level, path, kind, ok, status_code, reason, reason_class, message, request_id, state_id, platform, app_version, duration_ms
       FROM fixed_app_events WHERE ts >= $1 AND ts < $2 AND ok = false ${kindSql}
      ORDER BY ts DESC LIMIT $3`, [w.from.toISOString(), w.to.toISOString(), limit]).catch(e => ({ rows: [], error: e.message }));
  return { kind: 'applog', title: 'failed app-log events in the window', window: w, rows: r.rows || [], error: r.error, source: 'fixed_app_events',
    cols: ['When (KSA)', 'Endpoint', 'Status', 'Reason', 'Message', 'Request · state', 'Platform'] };
}

const EVIDENCE = [
  [/^semati/, `path ILIKE '%semati%'`], [/^nafath/, `path ILIKE '%nafath%'`], [/^otp|^sms/, `(path ILIKE '%otp%' OR path ILIKE '%sms%')`],
  [/^payment|^gateway|^recharge|samsung|^web_checkout/, `(path ILIKE '%payment%' OR path ILIKE '%recharge%' OR path ILIKE '%checkout%' OR path ILIKE '%tap%' OR path ILIKE '%upg%')`],
  [/^activation|^bss/, `(path ILIKE '%activation%' OR path ILIKE '%bss%' OR path ILIKE '%subscription%')`],
  [/^app_auth|^login|^auth/, `(path ILIKE '%sign_in%' OR path ILIKE '%auth%' OR path ILIKE '%login%')`], [/^eligibility/, `path ILIKE '%eligib%'`],
];
async function mobileApi(a, rule, { limit }) {
  const w = windowOf(a); const dim = (rule && rule.dim) || {};
  const apiDim = dim.api && !/^\(/.test(String(dim.api)) ? String(dim.api) : null;
  const fam = (EVIDENCE.find(([re]) => re.test(a.metric_key || '')) || [])[1];
  const where = apiDim ? `path = $3` : (fam || 'TRUE');
  const P = [w.from.toISOString(), w.to.toISOString()]; if (apiDim) P.push(apiDim); P.push(limit);
  const r = await db.console.query(
    `SELECT ts, host, path, transaction_id, coalesce(response_code,'—') AS code, coalesce(NULLIF(left(response_message,120),''),'(no message)') AS msg, err_class, duration_ms
       FROM api_traffic_events WHERE ts >= $1 AND ts < $2 AND ${where} AND coalesce(err_class,'') <> 'success'
      ORDER BY ts DESC LIMIT $${P.length}`, P).catch(e => ({ rows: [], error: e.message }));
  return { kind: 'api', title: apiDim ? `failed calls on ${apiDim}` : fam ? 'failed calls of this metric family' : 'failed API calls in the window', window: w, rows: r.rows || [], error: r.error, source: 'api_traffic_events',
    cols: ['When (KSA)', 'Endpoint', 'Code', 'Message', 'Transaction', 'Host'] };
}

/* INFRASTRUCTURE (30 Sep 2026): the hosts behind an infra_* / fixed_infra_* incident — the exact hosts the metric counted at
 * the last tick, with what the L2 needs without opening another page: IP · hostname · OS · CPU (model, count, %) · RAM (GB,
 * %) · disk (worst mount, %) · load · ports down · the failing probes with their thresholds. Same predicates as alertCases. */
const INFRA_NUM = {
  hosts_down: `h.reachable = false`,
  ports_down: `EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(h.last_metrics->'ports','[]'::jsonb)) p WHERE (p->>'ok') = 'false')`,
  hosts_crit: `h.status = 'crit'`,
  disk_pct_max: `coalesce((h.last_metrics->>'disk_pct')::float, 0) >= 80`,
  mem_pct_max: `coalesce((h.last_metrics->>'mem_pct')::float, 0) >= 85`,
  load_per_core_max: `coalesce((h.last_metrics->>'nproc')::float, 0) > 0 AND coalesce((h.last_metrics->>'load15')::float, 0) / (h.last_metrics->>'nproc')::float >= 1.5`,
};
const isInfraKey = k => /^(fixed_)?infra_/.test(String(k || ''));
async function infraHosts(a, { limit }) {
  const key = String(a.rule_key || a.metric_key || ''); const fixed = /^fixed_/.test(key);
  const kind = Object.keys(INFRA_NUM).find(k => key.includes('infra_' + k)) || 'hosts_crit';
  const w = windowOf(a);
  const r = await db.console.query(
    `SELECT h.id, h.label, h.ip, h.ips, h.segment, h.role, h.status, h.reachable, coalesce(h.status_at, h.updated_at) AS status_at, h.last_seen, h.diagram, h.node_id, h.owner_team,
            h.inventory->>'hostname' AS hostname, h.inventory->>'os' AS os, h.inventory->>'kernel' AS kernel, h.inventory->>'virt' AS virt, h.inventory->>'cpu_model' AS cpu_model,
            coalesce((h.inventory->>'cpus')::int, (h.last_metrics->>'nproc')::int) AS cpus, (h.inventory->>'ram_mb')::int AS ram_mb, h.inventory->>'boot_at' AS boot_at,
            (h.last_metrics->>'cpu_pct')::float AS cpu_pct, (h.last_metrics->>'mem_pct')::float AS mem_pct, (h.last_metrics->>'swap_pct')::float AS swap_pct,
            (h.last_metrics->>'disk_pct')::float AS disk_pct, h.last_metrics->'disks' AS disks, (h.last_metrics->>'load1')::float AS load1, (h.last_metrics->>'load15')::float AS load15,
            (h.last_metrics->>'conns')::int AS conns, h.last_metrics->'sources' AS sources, h.last_metrics->'ports' AS ports, h.last_metrics->>'at' AS metrics_at,
            (SELECT json_agg(json_build_object('probe', p.probe, 'level', p.level, 'value', p.value, 'threshold', p.threshold, 'note', p.note) ORDER BY CASE p.level WHEN 'CRIT' THEN 0 WHEN 'WARN' THEN 1 ELSE 2 END, p.probe)
               FROM infra_probes p WHERE p.host_id = h.id AND p.level IN ('CRIT','WARN') AND p.at >= (SELECT max(at) FROM infra_probes WHERE host_id = h.id) - interval '1 second') AS probes
       FROM infra_hosts h
      WHERE h.enabled AND h.segment = ANY($1::text[]) AND (${INFRA_NUM[kind]})
      ORDER BY CASE h.status WHEN 'crit' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, h.label LIMIT $2`, [fixed ? ['fixed'] : ['mobile', 'shared'], limit]).catch(e => ({ rows: [], error: e.message }));
  const rows = (r.rows || []).map(h => {
    const disks = Array.isArray(h.disks) ? h.disks : []; const worst = disks.length ? disks.reduce((a, d) => (d.pct > (a ? a.pct : -1) ? d : a), null) : null;
    const gb = kb => kb == null ? null : Math.round(kb / 1048576 * 10) / 10;
    const portsDown = (Array.isArray(h.ports) ? h.ports : []).filter(p => p && p.ok === false).map(p => p.port);
    const probes = Array.isArray(h.probes) ? h.probes : [];
    const issue = h.reachable === false ? 'host unreachable — no source answered (ssh, service ports, exporter)' : probes.length ? probes.map(p => `${p.probe} ${p.level}${p.value != null ? ' · ' + p.value : ''}${p.threshold ? ' (threshold ' + p.threshold + ')' : ''}`).join(' · ') : (h.status || 'unknown');
    return { ...h, disks, disk_worst: worst ? { mount: worst.mount, pct: worst.pct, size_gb: gb(worst.size_kb), used_gb: gb(worst.used_kb) } : null, ports_down: portsDown, probes, issue,
      ram_gb: h.ram_mb != null ? Math.round(h.ram_mb / 1024 * 10) / 10 : null, ram_used_gb: h.ram_mb != null && h.mem_pct != null ? Math.round(h.ram_mb * h.mem_pct / 1024 / 100 * 10) / 10 : null };
  });
  const TITLE = { hosts_down: 'hosts that do not answer any probe', ports_down: 'hosts with a service port closed', hosts_crit: 'hosts in CRIT', disk_pct_max: 'hosts with a filesystem ≥ 80 %', mem_pct_max: 'hosts with memory ≥ 85 %', load_per_core_max: 'hosts with load15 ≥ 1.5 per core' };
  return { kind: 'infra', title: `${TITLE[kind]} · ${fixed ? 'Fixed' : 'Mobile / shared'} · last tick`, window: w, rows, error: r.error, source: 'infra_hosts', segment: fixed ? 'fixed' : 'mobile',
    cols: ['Host · IP', 'Issue', 'CPU', 'RAM', 'Disk', 'Load', 'Ports', 'Since'] };
}

/* the entry point: evidence for one incident row */
async function forAlert(a, { limit = 25, unmask = false } = {}) {
  const lim = Math.min(100, Math.max(5, Number(limit) || 25));
  const rule = (await db.console.query(`SELECT dim, description FROM alert_rules WHERE key=$1`, [a.rule_key]).catch(() => ({ rows: [] }))).rows[0] || null;
  if (String(a.rule_key || '').includes('manual_ticket')) return { kind: 'none', rows: [], note: 'Manual ticket — the evidence is what the reporter wrote in the message and the discussion.' };
  if (a.rule_key === 'refund_batch' || a.rule_key === 'fixed_refund_batch') return { kind: 'none', rows: [], note: 'Internal ticket opened by the refund desk (Agent 2) for an approval batch — the cases, their evidence and the register state are on Refund exposure; the ticket resolves when every case is closed. Who approves and who executes: Teams management › Refund desks.' };
  try {
    if (isInfraKey(a.rule_key) || isInfraKey(a.metric_key)) return await infraHosts(a, { limit: lim });
    if (isAppLog(a.rule_key)) return await fixedAppLog(a, { limit: lim });
    if (isFixedKey(a.rule_key) || a.segment === 'fixed') {
      const dim = (rule && rule.dim) || {}; const channel = ['sda', 'epurchase', 'salamhome'].includes(dim.channel) ? dim.channel : null;
      return await fixedAttempts(a, { limit: lim, unmask, channel });
    }
    return await mobileApi(a, rule, { limit: lim });
  } catch (e) { return { kind: 'error', rows: [], error: e.message }; }
}

/* one attempt's calls — request / response bodies (masked at rest) for the "what did the app send" question */
async function attemptCalls(attemptId, { channel } = {}) {
  const id = String(attemptId || '').slice(0, 80); if (!id) throw Object.assign(new Error('attempt required'), { status: 400 });
  const pools = [f360.poolFor(channel)]; if (db.opsBeta && pools[0] !== db.opsBeta) pools.push(db.opsBeta);
  for (const pool of pools) {
    if (!pool) continue;
    const r = await pool.query(`SELECT id, method, endpoint, status, duration_ms, error_class, error_msg, left(coalesce(req_body::text,''), 4000) AS req_body, left(coalesce(res_body::text,''), 4000) AS res_body, created_at
        FROM api_calls WHERE attempt_id = $1 ORDER BY created_at ASC LIMIT 60`, [id]);
    if (r.rows.length) return { attempt: id, calls: r.rows, note: 'bodies are masked at ingest (PII cut to last digits); full context needs the audited unmask on the trace view' };
  }
  return { attempt: id, calls: [], note: 'no api_calls rows for this attempt (purged or not captured)' };
}

module.exports = { forAlert, attemptCalls, windowOf, attemptPredicate, maskRow, infraHosts, isInfraKey };
