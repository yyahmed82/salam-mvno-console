/* agentsApi.js — REST for Settings › Agents (llm.js · agentLog.js · agentIncident.js). Mounted from api.js:
 *   require('./agentsApi').mount(app, { audit, requireCap, requireRoot })
 * The agents themselves run as separate PM2 services; this file only READS their tables, edits their policy,
 * records reviews/feedback and offers "run now" (an in-process tick — same code, same DB, useful for a demo
 * or right after a deploy). Root tier only (same gate as Yusr's config). */
'use strict';
const db = require('./db');
const llm = require('./llm');

function mount(app, { audit, requireCap, requireRoot }) {
  const C = db.console; const gate = [requireCap('manageSync'), requireRoot('assist_config')];
  // tables exist before the agents' first tick, so the page never 500s on a fresh deploy (agents self-seed too)
  Promise.all([llm.ensureSchema(), require('./agentLog').ensureSchema(), require('./agentIncident').ensureSchema()]).catch(e => console.warn('[agents] schema:', e.message));
  const days = req => Math.min(90, Math.max(1, Number(req.query.days) || 7));

  /* ---- LLM layer ---- */
  app.get('/api/llm/status', ...gate, async (req, res) => { try { res.json(await llm.status()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/api/llm/probe', ...gate, async (req, res) => { try { res.json(await llm.probe()); } catch (e) { res.status(500).json({ error: e.message }); } });
  /* why does the model answer nothing? four probes of growing size → the verdict (context / grammar / not running) */
  app.post('/api/llm/selftest', ...gate, async (req, res) => {
    try { res.json(await llm.selftest((req.body && req.body.provider) === 'fallback' ? 'fallback' : 'primary')); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.put('/api/llm/config', ...gate, async (req, res) => {
    try {
      const b = req.body || {}; const patch = {};
      if (b.order) patch.order = b.order === 'fallback-first' ? 'fallback-first' : 'primary-first';
      for (const k of ['primary', 'fallback']) if (b[k] !== undefined) patch[k] = b[k] && b[k].url ? { kind: b[k].kind === 'openai' ? 'openai' : 'ollama', url: String(b[k].url).trim(), model: String(b[k].model || '').trim(), key: b[k].key === undefined ? undefined : String(b[k].key), timeoutMs: Number(b[k].timeoutMs) || undefined } : null;
      const cfg = await llm.setConfig(patch);
      await audit(req, 'llm.config', null, { order: cfg.order, primary: cfg.primary && cfg.primary.model, fallback: cfg.fallback && cfg.fallback.model });
      res.json(await llm.status());
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/llm/test', ...gate, async (req, res) => {
    try { const out = await llm.chat({ system: 'Reply with one short sentence.', user: String((req.body || {}).prompt || 'Say hello to the Salam operations team.'), purpose: 'llm.test', caller: req.actor, maxTokens: 60 }); res.json(out); }
    catch (e) { res.status(502).json({ error: e.message }); }
  });
  /* ---- AI budget & usage (11 Sep 2026, llmBudget.js) ---- */
  const budget = require('./llmBudget');
  budget.ensureSchema().catch(() => {});
  app.get('/api/llm/budget', ...gate, async (req, res) => { try { res.json(await budget.config()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.put('/api/llm/budget', ...gate, async (req, res) => {
    try { const next = await budget.setConfig(req.body || {}); if (audit) await audit(req, 'llm.budget', null, req.body || {}); res.json(next); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/llm/usage', ...gate, async (req, res) => {
    try { res.json(await budget.usage({ days: req.query.days, actor: req.query.user || '' })); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  /* every signed-in user may see THEIR OWN line (the Yusr panel shows it) — no admin gate here */
  app.get('/api/llm/usage/mine', async (req, res) => {
    try { res.json(await budget.mine(req.actor)); } catch (e) { res.json({ enabled: false, error: e.message }); }
  });

  app.get('/api/llm/calls', ...gate, async (req, res) => {
    try {
      const calls = (await C.query(
        `SELECT id, at, purpose, caller, actor, provider, model, ms, ok, fallback, blocked, prompt_chars, answer_chars, tokens, error
           FROM llm_calls ORDER BY at DESC LIMIT $1`, [Math.min(500, Number(req.query.limit) || 100)])).rows;
      let people = {};
      try { people = await require('./people').cards(C, calls.map(c => c.actor).filter(a => a && a.indexOf('@') > 0)); } catch (_) {}
      res.json({ calls, people });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ---- overview ---- */
  app.get('/api/agents/overview', ...gate, async (req, res) => {
    try {
      const q = async (sql, p) => { try { return (await C.query(sql, p)).rows; } catch (_) { return []; } };
      const runs = await q(`SELECT DISTINCT ON (agent) agent, started_at, finished_at, ok, stats, error FROM agent_runs ORDER BY agent, started_at DESC`);
      const runs24 = await q(`SELECT agent, count(*)::int AS runs, count(*) FILTER (WHERE ok)::int AS ok FROM agent_runs WHERE started_at >= now() - interval '24 hours' GROUP BY 1`);
      const sig = (await q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE first_seen >= now() - interval '24 hours')::int AS new24, count(*) FILTER (WHERE assessed_at IS NULL)::int AS unassessed,
          count(*) FILTER (WHERE status='new' AND assessed_at IS NOT NULL)::int AS to_review, count(*) FILTER (WHERE class='technical' AND last_seen >= now() - interval '24 hours')::int AS tech24, coalesce(sum(last_24h),0)::bigint AS events24,
          coalesce(sum(last_24h) FILTER (WHERE segment='mvno'),0)::bigint AS mvno24, coalesce(sum(last_24h) FILTER (WHERE segment='fixed'),0)::bigint AS fixed24,
          count(*) FILTER (WHERE segment='fixed')::int AS fixed_signatures FROM agent_signatures`))[0] || {};
      const tri = (await q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS d1, count(*) FILTER (WHERE kind='duplicate' AND created_at >= now() - interval '24 hours')::int AS dup24,
          count(*) FILTER (WHERE kind='flapping' AND created_at >= now() - interval '24 hours')::int AS flap24, count(*) FILTER (WHERE helpful)::int AS helpful, count(*) FILTER (WHERE helpful=false)::int AS unhelpful,
          count(*) FILTER (WHERE applied <> '{}'::jsonb)::int AS applied, round(avg(ms))::int AS avg_ms, round(avg(confidence)*100)::int AS avg_conf FROM agent_triage`))[0] || {};
      const reports = await q(`SELECT id, kind, period_start, period_end, mailed_to, created_at, left(narrative, 240) AS narrative FROM agent_reports ORDER BY created_at DESC LIMIT 7`);
      const state = await q(`SELECT key, value, updated_at FROM agent_state`);
      const st = await llm.status();
      /* the Fixed app log (combined.log) is the one source the user cannot see anywhere else — say plainly
       * whether the collector is armed and whether Yakeen lines are actually arriving */
      let applog = { configured: false };
      try { const col = require('./fixedAppLogCollector'); const p = await col.ping();
        const a24 = (await q(`SELECT count(*)::int AS n, count(*) FILTER (WHERE ok IS NOT TRUE)::int AS failed, count(*) FILTER (WHERE kind='yakeen')::int AS yakeen FROM fixed_app_events WHERE ts >= now() - interval '24 hours'`))[0] || {};
        applog = { configured: col.configured(), logPath: col.status().logPath, hosts: col.status().hosts, ...p, d1: a24 }; } catch (_) {}
      const alive = r => r && r.started_at && (Date.now() - new Date(r.started_at).getTime()) < 40 * 60000;
      res.json({ agents: { log: { last: runs.find(r => r.agent === 'log') || null, alive: alive(runs.find(r => r.agent === 'log')), d1: runs24.find(r => r.agent === 'log') || { runs: 0, ok: 0 }, state: (state.find(s => s.key === 'log') || {}).value || {} },
        incident: { last: runs.find(r => r.agent === 'incident') || null, alive: alive(runs.find(r => r.agent === 'incident')), d1: runs24.find(r => r.agent === 'incident') || { runs: 0, ok: 0 } } },
        signatures: sig, triage: tri, reports, llm: st, applog, policy: await require('./agentIncident').getPolicy() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ---- Agent 1 data ---- */
  app.get('/api/agents/signatures', ...gate, async (req, res) => {
    try {
      const w = [`last_seen >= now() - ($1||' days')::interval`]; const p = [String(days(req))];
      if (req.query.class && req.query.class !== 'all') { p.push(req.query.class); w.push(`class=$${p.length}`); }
      if (req.query.status && req.query.status !== 'all') { p.push(req.query.status); w.push(`status=$${p.length}`); }
      if (req.query.segment && req.query.segment !== 'all') { p.push(req.query.segment); w.push(`segment=$${p.length}`); }
      if (req.query.q) { p.push('%' + String(req.query.q).toLowerCase() + '%'); w.push(`(lower(coalesce(endpoint,'')||' '||coalesce(code,'')||' '||coalesce(message_pattern,'')||' '||coalesce(category,'')||' '||coalesce(owner_team,'')) LIKE $${p.length})`); }
      p.push(Math.min(1000, Number(req.query.limit) || 300));
      const rows = (await C.query(`SELECT id, sig_hash, source, segment, endpoint, code, message_pattern, sample, hosts, first_seen, last_seen, total, last_24h, class, category, severity_hint, probable_cause, owner_team, runbook, confidence, assessed_by, assessed_at, status, reviewed_by, reviewed_at, note FROM agent_signatures WHERE ${w.join(' AND ')} ORDER BY last_24h DESC, total DESC LIMIT $${p.length}`, p)).rows;
      res.json({ signatures: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.put('/api/agents/signatures/:id', ...gate, async (req, res) => {
    try {
      const b = req.body || {}; const status = ['new', 'assessed', 'reviewed', 'known', 'ignored', 'ticketed'].includes(b.status) ? b.status : null;
      const r = (await C.query(`UPDATE agent_signatures SET status=coalesce($2,status), note=coalesce($3,note), owner_team=coalesce($4,owner_team), class=coalesce($5,class), reviewed_by=$6, reviewed_at=now() WHERE id=$1 RETURNING id, status, note, owner_team, class`, [req.params.id, status, b.note === undefined ? null : String(b.note).slice(0, 500), b.owner_team ? String(b.owner_team).slice(0, 60) : null, ['business', 'technical'].includes(b.class) ? b.class : null, req.actor])).rows[0];
      if (!r) return res.status(404).json({ error: 'not found' });
      await audit(req, 'agent.signature.review', String(r.id), { status: r.status, owner_team: r.owner_team });
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/agents/reports', ...gate, async (req, res) => {
    try { res.json({ reports: (await C.query(`SELECT id, kind, period_start, period_end, mailed_to, created_at, narrative FROM agent_reports ORDER BY created_at DESC LIMIT $1`, [Math.min(100, Number(req.query.limit) || 30)])).rows }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/agents/reports/:id', ...gate, async (req, res) => {
    try { const r = (await C.query(`SELECT * FROM agent_reports WHERE id=$1`, [req.params.id])).rows[0]; if (!r) return res.status(404).json({ error: 'not found' }); res.json(r); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* ---- Agent 2 data ---- */
  app.get('/api/agents/triage', ...gate, async (req, res) => {
    try {
      const w = [`t.created_at >= now() - ($1||' days')::interval`]; const p = [String(days(req))];
      if (req.query.kind && req.query.kind !== 'all') { p.push(req.query.kind); w.push(`t.kind=$${p.length}`); }
      if (req.query.segment && req.query.segment !== 'all') { p.push(req.query.segment); w.push(`t.segment=$${p.length}`); }
      if (req.query.q) { p.push('%' + String(req.query.q).toLowerCase() + '%'); w.push(`(lower(coalesce(a.name,'')||' '||coalesce(t.rule_key,'')||' '||coalesce(t.probable_cause,'')||' '||coalesce(t.suggested_team,'')) LIKE $${p.length})`); }
      p.push(Math.min(1000, Number(req.query.limit) || 300));
      const rows = (await C.query(`SELECT t.*, a.name, a.status AS alert_status, a.fired_at, a.resolved_at, a.ack_by, a.ack_at, a.team, a.assignee FROM agent_triage t LEFT JOIN alerts a ON a.id=t.alert_id WHERE ${w.join(' AND ')} ORDER BY t.created_at DESC LIMIT $${p.length}`, p)).rows;
      res.json({ triage: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.put('/api/agents/triage/:id/feedback', ...gate, async (req, res) => {
    try {
      const helpful = (req.body || {}).helpful; if (typeof helpful !== 'boolean') return res.status(400).json({ error: 'helpful must be boolean' });
      const r = (await C.query(`UPDATE agent_triage SET helpful=$2, feedback_by=$3, feedback_at=now() WHERE id=$1 RETURNING id, alert_id, helpful`, [req.params.id, helpful, req.actor])).rows[0];
      if (!r) return res.status(404).json({ error: 'not found' });
      await audit(req, 'agent.triage.feedback', String(r.alert_id), { helpful });
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/agents/policy', ...gate, async (req, res) => {
    try { const ai = require('./agentIncident'); res.json({ policy: await ai.getPolicy(), rules: (await C.query(`SELECT key, name, severity, team, enabled FROM alert_rules ORDER BY key`)).rows }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.put('/api/agents/policy', ...gate, async (req, res) => {
    try {
      const b = req.body || {}; const ai = require('./agentIncident');
      const list = x => Array.isArray(x) ? x.map(String).slice(0, 200) : undefined;
      const patch = {}; if (b.mode) patch.mode = b.mode === 'assist' ? 'assist' : 'advise'; if (list(b.autoTeam)) patch.autoTeam = list(b.autoTeam); if (list(b.autoResolveDup)) patch.autoResolveDup = list(b.autoResolveDup);
      const pol = await ai.setPolicy(patch);
      await audit(req, 'agent.policy', null, pol);
      res.json({ policy: pol });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  /* ---- run now (in-process tick; the PM2 agents keep their own cadence) ---- */
  app.post('/api/agents/run/:agent', ...gate, async (req, res) => {
    try {
      const which = req.params.agent; let out;
      if (which === 'log') { const al = require('./agentLog'); await al.ensureSchema(); out = await al.tick(); out = out || { ran: true }; }
      else if (which === 'incident') { const ai = require('./agentIncident'); await ai.ensureSchema(); out = await ai.tick(Math.min(20, Number((req.body || {}).limit) || 5)); }
      else if (which === 'report') { const al = require('./agentLog'); await al.ensureSchema(); out = await al.dailyReport(new Date()); }
      else if (which === 'map') { const ai = require('./agentIncident'); await ai.ensureSchema(); out = await ai.mapRules({ force: !!(req.body || {}).force }); }
      else return res.status(400).json({ error: 'agent must be log | incident | report | map' });
      await audit(req, 'agent.run', which, out);
      res.json({ agent: which, result: out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}
module.exports = { mount };
