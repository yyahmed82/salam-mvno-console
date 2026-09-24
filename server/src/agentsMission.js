/* agentsMission.js — AI agents MISSION CONTROL: what every agent did, is doing now, and should do next (24 Sep 2026).
 *
 * The Settings › Agents page configures the models (root tier). This is the OPERATIONS view of the same services,
 * readable by anyone who works incidents: one JSON with, per agent,
 *   did    — the recent runs (agent_runs) turned into sentences + their concrete outputs (triage notes, new signatures,
 *            team proposals, reports)
 *   now    — running / idle / stale / disabled, the run in progress, the model calls of the last minutes
 *   next   — the next scheduled tick (last start + interval), the queue waiting for it (open incidents without a note,
 *            signatures not assessed, rules without a team), the next daily report, and what waits for a HUMAN
 *            (proposals to approve, signatures to review, triage notes without feedback)
 * plus the brain (llm.status + today's tokens per caller) and a 24 h timeline (runs + model calls per hour) for the
 * replay. Read-only, every query guarded, never 500s on a fresh install (missing tables → empty sections).
 *   GET /api/agents/mission      gate: any Mobile/Fixed alerts view, or manageSync */
'use strict';
const db = require('./db');

const C = () => db.console;
const n = v => Number(v) || 0;
const KSA = 3 * 3600e3;
const INTERVALS = {
  log: Math.max(2, Number(process.env.AGENT_LOG_INTERVAL_MIN) || 15) * 60e3,
  incident: Math.max(1, Number(process.env.AGENT_INCIDENT_INTERVAL_MIN) || 3) * 60e3,
  'incident.map': 6 * 3600e3,
};
const REPORT_HOUR = Number.isFinite(Number(process.env.AGENT_LOG_REPORT_HOUR)) ? Number(process.env.AGENT_LOG_REPORT_HOUR) : 6;
const ENABLED = { log: process.env.AGENT_LOG_ENABLED !== '0', incident: process.env.AGENT_INCIDENT_ENABLED !== '0' };

/* one run → a sentence a human reads on the wall */
function narrate(agent, r) {
  const s = r.stats || {};
  if (r.ok === false) return `failed — ${String(r.error || 'unknown error').slice(0, 120)}`;
  if (r.ok == null && !r.finished_at) return 'running…';
  if (agent === 'log') {
    const bits = [];
    if (s.events != null) bits.push(`read ${n(s.events).toLocaleString()} error events`);
    if (s.signatures != null) bits.push(`${n(s.signatures)} signatures`);
    if (s.fresh) bits.push(`${n(s.fresh)} NEW`);
    if (s.assessed) bits.push(`assessed ${n(s.assessed)} with the model`);
    if (s.report) bits.push(`daily report mailed`);
    return bits.length ? bits.join(' · ') : 'nothing new in the log';
  }
  if (agent === 'incident') {
    if (!n(s.checked)) return 'no open incident waiting for a note';
    const bits = [`looked at ${n(s.checked)} open incident(s)`];
    if (n(s.triaged)) bits.push(`wrote ${n(s.triaged)} triage note(s)`);
    if (n(s.duplicates)) bits.push(`${n(s.duplicates)} duplicate(s)`);
    if (n(s.flapping)) bits.push(`${n(s.flapping)} flapping`);
    if (n(s.modelled)) bits.push(`${n(s.modelled)} with the model`);
    if (n(s.applied)) bits.push(`${n(s.applied)} policy action(s)`);
    if (n(s.errors)) bits.push(`${n(s.errors)} error(s)`);
    return bits.join(' · ');
  }
  if (agent === 'incident.map') {
    if (!n(s.rules)) return 'no rule to map';
    return `${n(s.rules)} rules → ${n(s.proposed)} proposal(s) (${n(s.deterministic)} by keywords · ${n(s.modelled)} by the model · ${n(s.lowConfidence)} weak) · ${n(s.unchanged)} unchanged${s.modelUnavailable ? ' · model unavailable' : ''}`;
  }
  return JSON.stringify(s).slice(0, 140);
}
const nextTick = (last, every) => last ? new Date(new Date(last).getTime() + every) : null;
function nextReport() {
  const now = Date.now(); const k = new Date(now + KSA); k.setUTCHours(REPORT_HOUR, 0, 0, 0);
  let t = k.getTime() - KSA; if (t <= now) t += 864e5; return new Date(t);
}

async function mission() {
  const q = async (sql, p) => { try { return (await C().query(sql, p)).rows; } catch (e) { return []; } };
  const now = Date.now();
  const [runs, hourly, calls5, callsHour, tokensToday, triage, sigs, sigNew, proposals, reports, queue, feedback, yusr] = await Promise.all([
    q(`SELECT agent, started_at, finished_at, ok, stats, error FROM (SELECT *, row_number() OVER (PARTITION BY agent ORDER BY started_at DESC) rn FROM agent_runs WHERE started_at >= now() - interval '48 hours') x WHERE rn <= 40 ORDER BY started_at DESC`),
    q(`SELECT agent, date_trunc('hour', started_at) AS h, count(*)::int AS runs, count(*) FILTER (WHERE ok = false)::int AS failed FROM agent_runs WHERE started_at >= now() - interval '24 hours' GROUP BY 1,2`),
    q(`SELECT caller, purpose, count(*)::int AS calls, max(at) AS last_at, round(avg(ms))::int AS avg_ms, count(*) FILTER (WHERE NOT ok)::int AS failed FROM llm_calls WHERE at >= now() - interval '5 minutes' GROUP BY 1,2`),
    q(`SELECT coalesce(caller,'console') AS caller, date_trunc('hour', at) AS h, count(*)::int AS calls, coalesce(sum(tokens),0)::int AS tokens FROM llm_calls WHERE at >= now() - interval '24 hours' GROUP BY 1,2`),
    q(`SELECT coalesce(caller,'console') AS caller, count(*)::int AS calls, count(*) FILTER (WHERE ok)::int AS ok, count(*) FILTER (WHERE blocked)::int AS blocked, coalesce(sum(tokens),0)::bigint AS tokens, round(avg(ms) FILTER (WHERE ok))::int AS avg_ms
         FROM llm_calls WHERE at >= date_trunc('day', now() + interval '3 hours') - interval '3 hours' GROUP BY 1`),
    q(`SELECT t.alert_id, t.kind, t.severity, t.segment, t.priority_hint, t.suggested_team, t.confidence, t.probable_cause, t.suggested_action, t.model, t.ms, t.helpful, t.created_at, a.name, a.status
         FROM agent_triage t LEFT JOIN alerts a ON a.id = t.alert_id ORDER BY t.created_at DESC LIMIT 10`),
    q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE first_seen >= now() - interval '24 hours')::int AS new24, count(*) FILTER (WHERE assessed_at IS NULL)::int AS unassessed,
              count(*) FILTER (WHERE status='new' AND assessed_at IS NOT NULL)::int AS to_review, coalesce(sum(last_24h),0)::bigint AS events24 FROM agent_signatures`),
    q(`SELECT id, segment, source, endpoint, code, class, category, severity_hint, owner_team, confidence, first_seen, last_24h, left(message_pattern, 120) AS pattern FROM agent_signatures WHERE assessed_at IS NOT NULL ORDER BY assessed_at DESC LIMIT 8`),
    q(`SELECT rule_key, segment, current_team, suggested_team, confidence, method, reason, status, created_at, decided_at FROM alert_rule_team_suggestions ORDER BY (status='proposed') DESC, updated_at DESC LIMIT 10`),
    q(`SELECT id, kind, period_start, period_end, mailed_to, created_at, left(narrative, 300) AS narrative FROM agent_reports ORDER BY created_at DESC LIMIT 2`),
    q(`SELECT (SELECT count(*)::int FROM alerts a WHERE a.status = 'open' AND NOT EXISTS (SELECT 1 FROM agent_triage t WHERE t.alert_id = a.id)) AS open_untriaged,
              (SELECT count(*)::int FROM alerts WHERE status = 'open') AS open_total,
              (SELECT count(*)::int FROM alert_rule_team_suggestions WHERE status = 'proposed') AS proposals_pending,
              (SELECT count(*)::int FROM alert_rules r WHERE coalesce(r.enabled, true) AND NOT EXISTS (SELECT 1 FROM alert_rule_team_suggestions s WHERE s.rule_key = r.key) AND (r.team IS NULL OR r.team = '')) AS rules_unmapped`),
    q(`SELECT count(*) FILTER (WHERE helpful IS NULL AND created_at >= now() - interval '7 days')::int AS awaiting, count(*) FILTER (WHERE helpful)::int AS helpful, count(*) FILTER (WHERE helpful = false)::int AS unhelpful FROM agent_triage`),
    q(`SELECT count(*)::int AS calls24, count(DISTINCT actor)::int AS people24, round(avg(ms) FILTER (WHERE ok))::int AS avg_ms, max(at) AS last_at, count(*) FILTER (WHERE blocked)::int AS blocked FROM llm_calls WHERE purpose LIKE 'yusr.%' AND at >= now() - interval '24 hours'`),
  ]);
  const byAgent = k => runs.filter(r => r.agent === k);
  const last = k => byAgent(k)[0] || null;
  const running = r => r && r.finished_at == null && (now - new Date(r.started_at).getTime()) < 30 * 60e3;
  const stateOf = (k, enabled) => {
    const r = last(k); if (!enabled) return 'disabled';
    if (!r) return 'never';
    if (running(r)) return 'working';
    const every = INTERVALS[k]; const age = now - new Date(r.started_at).getTime();
    if (age > every * 2.5 + 5 * 60e3) return 'stale';
    if (r.ok === false) return 'error';
    return 'idle';
  };
  const callsOf = caller => calls5.filter(c => c.caller === caller);
  const hoursOf = k => hourly.filter(h => h.agent === k).map(h => ({ h: h.h, runs: h.runs, failed: h.failed }));
  const tokOf = caller => tokensToday.find(t => t.caller === caller) || { calls: 0, ok: 0, blocked: 0, tokens: 0, avg_ms: null };
  const qz = queue[0] || {};
  const fb = feedback[0] || {};
  const sg = sigs[0] || {};
  const agents = [
    { key: 'log', name: 'Log intelligence', short: 'Agent 1', pm2: 'salam-agent-log', role: 'Reads every API error line, folds it into signatures, asks the model what each NEW signature means, mails the daily report.',
      state: stateOf('log', ENABLED.log), enabled: ENABLED.log, last: last('log'), every: INTERVALS.log, next: nextTick(last('log') && last('log').started_at, INTERVALS.log),
      did: byAgent('log').slice(0, 12).map(r => ({ at: r.started_at, end: r.finished_at, ok: r.ok, text: narrate('log', r), stats: r.stats })),
      outputs: { signatures: sigNew, report: reports[0] || null },
      queue: [{ label: 'signatures to assess', n: n(sg.unassessed), hint: 'new signatures the model has not explained yet' }, { label: 'events folded in 24 h', n: n(sg.events24), hint: 'error events counted into signatures' }],
      human: [{ label: 'signatures to review', n: n(sg.to_review), hint: 'assessed by the model, waiting for a human verdict', link: '#agents' }],
      calls: callsOf('salam-agent-log'), hours: hoursOf('log'), tokens: tokOf('salam-agent-log'), tokensHourly: callsHour.filter(c => c.caller === 'salam-agent-log'),
      next: { tick: nextTick(last('log') && last('log').started_at, INTERVALS.log), report: nextReport(), reportHour: REPORT_HOUR } },
    { key: 'incident', name: 'Incident triage', short: 'Agent 2', pm2: 'salam-agent-incident', role: 'Every open incident without a note gets one: duplicate / flapping detection, 30-day history, then a model verdict — cause, impact, team, first action.',
      state: stateOf('incident', ENABLED.incident), enabled: ENABLED.incident, last: last('incident'), every: INTERVALS.incident,
      did: byAgent('incident').filter(r => n((r.stats || {}).checked) || r.ok === false).slice(0, 12).map(r => ({ at: r.started_at, end: r.finished_at, ok: r.ok, text: narrate('incident', r), stats: r.stats })),
      quiet: byAgent('incident').filter(r => !n((r.stats || {}).checked) && r.ok !== false).length,
      outputs: { triage },
      queue: [{ label: 'open incidents without a note', n: n(qz.open_untriaged), hint: `of ${n(qz.open_total)} open — picked up on the next tick`, link: '#alerts' }],
      human: [{ label: 'triage notes awaiting feedback', n: n(fb.awaiting), hint: `helpful ${n(fb.helpful)} · not helpful ${n(fb.unhelpful)} — 👍 / 👎 on the incident teaches the agent`, link: '#alerts' }],
      calls: callsOf('salam-agent-incident').filter(c => c.purpose !== 'agent-incident.map'), hours: hoursOf('incident'), tokens: tokOf('salam-agent-incident'), tokensHourly: callsHour.filter(c => c.caller === 'salam-agent-incident'),
      next: { tick: nextTick(last('incident') && last('incident').started_at, INTERVALS.incident) } },
    { key: 'map', name: 'Team mapping', short: 'Agent 2 · mapper', pm2: 'salam-agent-incident', role: 'Proposes which responder team owns each alert rule — keywords first, the model for the ambiguous ones — and waits for a human to approve.',
      state: stateOf('incident.map', ENABLED.incident), enabled: ENABLED.incident, last: last('incident.map'), every: INTERVALS['incident.map'],
      did: byAgent('incident.map').slice(0, 8).map(r => ({ at: r.started_at, end: r.finished_at, ok: r.ok, text: narrate('incident.map', r), stats: r.stats })),
      outputs: { proposals },
      queue: [{ label: 'rules without a team', n: n(qz.rules_unmapped), hint: 'enabled rules with no owner and no proposal yet' }],
      human: [{ label: 'proposals to approve', n: n(qz.proposals_pending), hint: 'nothing is applied until someone approves it', link: '#alerts?tab=rules' }],
      calls: callsOf('salam-agent-incident').filter(c => c.purpose === 'agent-incident.map'), hours: hoursOf('incident.map'), tokens: { calls: 0, tokens: 0 }, tokensHourly: [],
      next: { tick: nextTick(last('incident.map') && last('incident.map').started_at, INTERVALS['incident.map']) } },
    { key: 'yusr', name: 'Yusr assistant', short: 'Assistant', pm2: 'salam-unified', role: 'Answers the people on the console — incidents, KPIs, customers — with the same on-prem model; rule-based when the budget is spent.',
      state: (yusr[0] && n(yusr[0].calls24)) ? ((now - new Date(yusr[0].last_at).getTime()) < 5 * 60e3 ? 'working' : 'idle') : 'idle', enabled: true, last: null, every: null,
      did: [], outputs: { yusr: yusr[0] || {} }, queue: [], human: [],
      calls: callsOf('console'), hours: [], tokens: tokOf('console'), tokensHourly: callsHour.filter(c => c.caller === 'console'), next: {} },
  ];
  let brain = null; try { brain = await require('./llm').status(); } catch (e) { brain = { error: e.message }; }
  const budget = { today: tokensToday, total: tokensToday.reduce((a, t) => a + n(t.tokens), 0) };
  const [pf, usage] = await Promise.all([perf(), usage7d(q)]);
  const PROC = { log: 'salam-agent-log', incident: 'salam-agent-incident', map: 'salam-agent-incident', yusr: 'salam-unified' };
  const CALLER = { log: 'salam-agent-log', incident: 'salam-agent-incident', map: 'salam-agent-incident', yusr: 'console' };
  for (const a of agents) { a.proc = pf.procs[PROC[a.key]] || null; a.usage = usage.byCaller[CALLER[a.key]] || null; }
  return { at: new Date().toISOString(), agents, brain, budget, perf: pf, usage, timeline: { runs: hourly, calls: callsHour }, intervals: INTERVALS, reportHour: REPORT_HOUR };
}

/* ---------------- performance: the host, the PM2 processes, the model server ---------------- */
const os = require('os'); const fs = require('fs'); const { execFile } = require('child_process');
let perfCache = { at: 0, v: null };
function cpuSnap() { try { const l = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number); const idle = l[3] + (l[4] || 0); const total = l.reduce((a, b) => a + b, 0); return { idle, total }; } catch (_) { return null; } }
let lastCpu = cpuSnap(), lastCpuAt = Date.now(), cpuPct = null;
async function hostPerf() {
  const now = Date.now(); const c = cpuSnap();
  if (c && lastCpu && c.total > lastCpu.total && now - lastCpuAt > 2000) { cpuPct = Math.round((1 - (c.idle - lastCpu.idle) / (c.total - lastCpu.total)) * 100); lastCpu = c; lastCpuAt = now; }
  const mem = (() => { try { const m = {}; for (const l of fs.readFileSync('/proc/meminfo', 'utf8').split('\n')) { const x = /^(\w+):\s+(\d+)/.exec(l); if (x) m[x[1]] = Number(x[2]) * 1024; } return { total: m.MemTotal, avail: m.MemAvailable, used: m.MemTotal - m.MemAvailable }; } catch (_) { return { total: os.totalmem(), avail: os.freemem(), used: os.totalmem() - os.freemem() }; } })();
  return { hostname: os.hostname(), cores: os.cpus().length, cpuModel: (os.cpus()[0] || {}).model || '', load: os.loadavg().map(x => Math.round(x * 100) / 100), cpuPct, mem, uptimeSec: Math.round(os.uptime()), gpu: await gpuPerf() };
}
function run(cmd, args, ms = 5000) { return new Promise(res => { try { execFile(cmd, args, { timeout: ms, env: { ...process.env, PATH: (process.env.PATH || '') + ':/usr/local/bin:/usr/bin:/bin' }, maxBuffer: 8e6 }, (e, out) => res(e ? null : String(out))); } catch (_) { res(null); } }); }
async function gpuPerf() {
  const out = await run('nvidia-smi', ['--query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu', '--format=csv,noheader,nounits'], 3000);
  if (!out) return null;
  return out.trim().split('\n').filter(Boolean).map(l => { const [name, mu, mt, util, temp] = l.split(',').map(x => x.trim()); return { name, memUsedMb: Number(mu), memTotalMb: Number(mt), utilPct: Number(util), tempC: Number(temp) }; });
}
async function pm2Perf() {
  const out = await run('pm2', ['jlist'], 6000); const procs = {};
  if (out) { try { for (const p of JSON.parse(out)) { const e = p.pm2_env || {}; procs[p.name] = { pid: p.pid, status: e.status, cpuPct: p.monit ? p.monit.cpu : null, memBytes: p.monit ? p.monit.memory : null, uptimeSec: e.pm_uptime ? Math.round((Date.now() - e.pm_uptime) / 1000) : null, restarts: e.restart_time || 0, node: e.node_version || null }; } } catch (_) {} }
  if (!Object.keys(procs).length) { const mu = process.memoryUsage(); procs[process.env.PM2_NAME || process.env.name || 'salam-unified'] = { pid: process.pid, status: 'online', cpuPct: null, memBytes: mu.rss, uptimeSec: Math.round(process.uptime()), restarts: null, self: true }; }
  return procs;
}
async function modelServerPerf() {
  let cfg = null; try { cfg = await require('./llm').getConfig(); } catch (_) {}
  const p = cfg && cfg.primary; if (!p || !p.url) return null;
  if (p.kind !== 'ollama') return { kind: p.kind, url: p.url, note: 'OpenAI-compatible server — no process view from here' };
  try { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(p.url.replace(/\/+$/, '') + '/api/ps', { signal: ctl.signal }); clearTimeout(t); const j = await r.json();
    return { kind: 'ollama', url: p.url, models: (j.models || []).map(m => ({ name: m.name, sizeBytes: m.size, vramBytes: m.size_vram, processor: m.size_vram ? (m.size_vram >= m.size ? 'GPU' : `${Math.round(m.size_vram / m.size * 100)}% GPU`) : 'CPU', params: m.details && m.details.parameter_size, quant: m.details && m.details.quantization_level, expiresAt: m.expires_at })) };
  } catch (e) { return { kind: 'ollama', url: p.url, error: e.name === 'AbortError' ? 'no answer in 2.5 s' : e.message }; }
}
async function perf() {
  if (Date.now() - perfCache.at < 10e3 && perfCache.v) return perfCache.v;
  const [host, procs, model] = await Promise.all([hostPerf(), pm2Perf(), modelServerPerf()]);
  perfCache = { at: Date.now(), v: { host, procs, model } }; return perfCache.v;
}
/* the last 7 days of model calls — what a GPU move has to carry (sizing) */
let usageCache = { at: 0, v: null };
async function usage7d(q) {
  if (Date.now() - usageCache.at < 60e3 && usageCache.v) return usageCache.v;
  const v = await usage7dRaw(q); usageCache = { at: Date.now(), v }; return v;
}
async function usage7dRaw(q) {
  const rows = await q(`SELECT coalesce(caller,'console') AS caller, count(*)::int AS calls, count(*) FILTER (WHERE ok)::int AS ok, count(*) FILTER (WHERE blocked)::int AS blocked,
      coalesce(sum(tokens),0)::bigint AS tokens, coalesce(sum(prompt_tokens),0)::bigint AS prompt_tokens, coalesce(sum(answer_tokens),0)::bigint AS answer_tokens,
      round(avg(ms) FILTER (WHERE ok))::int AS avg_ms, percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) FILTER (WHERE ok)::int AS p95_ms, max(ms)::int AS max_ms,
      round((sum(answer_tokens) FILTER (WHERE ok AND ms > 0))::numeric * 1000 / nullif(sum(ms) FILTER (WHERE ok AND ms > 0), 0), 1)::float AS tok_s
    FROM llm_calls WHERE at >= now() - interval '7 days' GROUP BY 1`);
  const days = await q(`SELECT date_trunc('day', at + interval '3 hours') AS d, count(*)::int AS calls, coalesce(sum(tokens),0)::bigint AS tokens FROM llm_calls WHERE at >= now() - interval '7 days' GROUP BY 1 ORDER BY 1`);
  const peakHour = (await q(`SELECT date_trunc('hour', at) AS h, count(*)::int AS calls, coalesce(sum(tokens),0)::bigint AS tokens, coalesce(sum(answer_tokens),0)::bigint AS answer_tokens FROM llm_calls WHERE at >= now() - interval '7 days' GROUP BY 1 ORDER BY tokens DESC LIMIT 1`))[0] || null;
  const conc = (await q(`SELECT max(c)::int AS max_concurrent FROM (SELECT count(*) AS c FROM llm_calls a JOIN llm_calls b ON b.at < a.at + (a.ms || ' ms')::interval AND b.at + (b.ms || ' ms')::interval > a.at WHERE a.at >= now() - interval '24 hours' AND b.at >= now() - interval '24 hours' GROUP BY a.id) x`))[0] || {};
  const byCaller = {}; for (const r of rows) byCaller[r.caller] = r;
  const tot = { calls: 0, tokens: 0, prompt_tokens: 0, answer_tokens: 0, ms: 0 }; for (const r of rows) { tot.calls += n(r.calls); tot.tokens += n(r.tokens); tot.prompt_tokens += n(r.prompt_tokens); tot.answer_tokens += n(r.answer_tokens); tot.ms += n(r.avg_ms) * n(r.ok); }
  const okCalls = rows.reduce((a, r) => a + n(r.ok), 0);
  return { byCaller, days, peakHour, maxConcurrent: n(conc.max_concurrent), total: { ...tot, avg_ms: okCalls ? Math.round(tot.ms / okCalls) : null, perDay: { calls: Math.round(tot.calls / 7), tokens: Math.round(tot.tokens / 7) } } };
}

function mount(app, { requireCap }) {
  const gate = (req, res, next) => {
    const v = req.views || []; const caps = req.caps || {};
    if (caps.manageSync || v.includes('alerts') || v.includes('fixed_alerts') || v.includes('monitoring')) return next();
    return res.status(403).json({ error: `role ${req.roleName} cannot read the agents' mission` });
  };
  app.get('/api/agents/mission', gate, async (req, res) => { try { res.json(await mission()); } catch (e) { res.status(500).json({ error: e.message }); } });
  void requireCap;
}
module.exports = { mount, mission, perf, usage7d };
