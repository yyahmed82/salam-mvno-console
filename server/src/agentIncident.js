/* agentIncident.js — AGENT 2 · INCIDENT OPERATIONS (separate PM2 service `salam-agent-incident`, 10 Sep 2026).
 *
 * Loop (every AGENT_INCIDENT_INTERVAL_MIN, default 3): every OPEN alert that has no triage yet gets one —
 *   1. deterministic first (no model): duplicate of an already-triaged open incident of the same rule (same
 *      root, within 60 min) · flapping (reopen_count ≥ 3) · what the same rule did in the last 30 days (count,
 *      median lifetime, how it was usually closed) · what else fired around the same minute (correlation) ·
 *      the busiest error signatures Agent 1 saw in the last 2 h for that side;
 *   2. then ONE LLM call with that evidence (JSON out): probable cause, customer impact, suggested team,
 *      the first concrete action, priority hint, confidence;
 *   3. the result is stored in agent_triage and posted as a SYSTEM comment on the incident — so it shows in the
 *      incident drawer, in the history XLSX and in the reminder mails. Nothing is silent.
 * Autonomy is opt-in per rule (settings key 'agent_incident'):
 *   { mode:'advise'|'assist', autoTeam:[rule keys…], autoResolveDup:[rule keys…] }
 *   'assist' + rule in autoTeam     → alerts.team is set to the suggested team when it is empty (audited comment)
 *   'assist' + rule in autoResolveDup → an incident detected as an exact duplicate is resolved with a comment
 *   Everything else stays advisory: humans acknowledge, assign, close. Reminders/escalations remain ackSla.js.
 * Never writes to production or replica DBs; only unified_console. Disable with AGENT_INCIDENT_ENABLED=0 (idles). */
'use strict';
process.env.TZ = process.env.TZ || 'UTC';
const db = require('./db');
const llm = require('./llm');
const teams = require('./teams');   // responder teams registry (24 Sep 2026) — the model picks from it, never invents a team

const CFG = {
  retryMin: Number(process.env.AGENT_INCIDENT_RETRY_MIN) || 10,     // wait this long before retrying a model-less triage
  maxRetries: Number(process.env.AGENT_INCIDENT_MAX_RETRIES) || 6,  // …and give up after this many attempts
  enabled: process.env.AGENT_INCIDENT_ENABLED !== '0',
  intervalMin: Math.max(1, Number(process.env.AGENT_INCIDENT_INTERVAL_MIN) || 3),
  maxPerTick: Math.max(1, Number(process.env.AGENT_INCIDENT_MAX_PER_TICK) || 8),
  lookbackHours: 48, dupWindowMin: 60,
};
const log = (...a) => console.log(`[AGENT-INC] ${new Date().toISOString()}`, ...a);
const C = () => db.console;

async function ensureSchema() {
  await C().query(`CREATE TABLE IF NOT EXISTS agent_triage (
      id bigserial PRIMARY KEY, alert_id bigint UNIQUE NOT NULL, segment text NOT NULL DEFAULT 'mvno', rule_key text, severity text,
      kind text NOT NULL DEFAULT 'triage',            -- triage | duplicate | flapping
      duplicate_of bigint, probable_cause text, impact text, suggested_team text, suggested_action text, priority_hint text, confidence real,
      similar_30d integer, median_life_min integer, usual_close text, correlated jsonb NOT NULL DEFAULT '[]', top_signatures jsonb NOT NULL DEFAULT '[]',
      model text, ms integer, applied jsonb NOT NULL DEFAULT '{}', helpful boolean, feedback_by text, feedback_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now())`);
  await C().query(`CREATE INDEX IF NOT EXISTS idx_agent_triage_at ON agent_triage (created_at DESC)`);
  /* retry bookkeeping for a triage the model never answered (11 Sep 2026) */
  await C().query(`ALTER TABLE agent_triage ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 1`).catch(() => {});
  await C().query(`ALTER TABLE agent_triage ADD COLUMN IF NOT EXISTS retried_at timestamptz`).catch(() => {});
  await C().query(`CREATE TABLE IF NOT EXISTS agent_runs (id bigserial PRIMARY KEY, agent text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, ok boolean, stats jsonb NOT NULL DEFAULT '{}', error text)`);
}
async function getPolicy() {
  try { const s = (await require('./settings').getSetting('agent_incident')) || {}; return { mode: s.mode === 'assist' ? 'assist' : 'advise', autoTeam: Array.isArray(s.autoTeam) ? s.autoTeam : [], autoResolveDup: Array.isArray(s.autoResolveDup) ? s.autoResolveDup : [] }; }
  catch (_) { return { mode: 'advise', autoTeam: [], autoResolveDup: [] }; }
}
async function setPolicy(patch) { const settings = require('./settings'); const cur = (await settings.getSetting('agent_incident')) || {}; await settings.setSetting('agent_incident', { ...cur, ...(patch || {}) }); return getPolicy(); }
const comment = (alertId, body) => C().query(`INSERT INTO incident_comments (alert_id, author, body) VALUES ($1,'agent',$2)`, [alertId, body]).catch(() => {});
const segOf = a => (a.segment === 'fixed' || /^fixed_/.test(a.rule_key || '')) ? 'fixed' : 'mvno';

/* ---- evidence (deterministic) ---- */
async function evidence(a) {
  const q = C();
  const seg = segOf(a);
  const dup = (await q.query(`SELECT t.alert_id, a.fired_at FROM agent_triage t JOIN alerts a ON a.id=t.alert_id WHERE a.rule_key=$1 AND a.status='open' AND a.id<>$2 AND t.kind='triage' AND a.fired_at >= $3::timestamptz - ($4||' minutes')::interval ORDER BY a.fired_at DESC LIMIT 1`, [a.rule_key, a.id, a.fired_at, String(CFG.dupWindowMin)])).rows[0] || null;
  const hist = (await q.query(`SELECT count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (resolved_at - fired_at))/60)::int AS med_min,
      count(*) FILTER (WHERE ack_at IS NOT NULL)::int AS acked, mode() WITHIN GROUP (ORDER BY coalesce(assignee, ack_by)) AS usual_person
      FROM alerts WHERE rule_key=$1 AND id<>$2 AND status='resolved' AND fired_at >= now() - interval '30 days'`, [a.rule_key, a.id])).rows[0] || {};
  const lastClose = (await q.query(`SELECT c.body FROM incident_comments c JOIN alerts x ON x.id=c.alert_id WHERE x.rule_key=$1 AND x.status='resolved' AND c.author<>'system' AND c.author<>'agent' ORDER BY c.created_at DESC LIMIT 1`, [a.rule_key])).rows[0];
  const corr = (await q.query(`SELECT id, rule_key, name, severity, status FROM alerts WHERE id<>$1 AND fired_at BETWEEN $2::timestamptz - interval '10 minutes' AND $2::timestamptz + interval '10 minutes' ORDER BY severity, fired_at LIMIT 8`, [a.id, a.fired_at])).rows;
  const sigs = (await q.query(`SELECT source, endpoint, code, last_24h, class, category, probable_cause FROM agent_signatures WHERE segment=$1 AND last_seen >= now() - interval '2 hours' ORDER BY last_24h DESC LIMIT 5`, [seg]).catch(() => ({ rows: [] }))).rows;
  const rule = (await q.query(`SELECT description, team, alert_class, params FROM alert_rules WHERE key=$1`, [a.rule_key]).catch(() => ({ rows: [] }))).rows[0] || {};
  const comments = (await q.query(`SELECT author, body FROM incident_comments WHERE alert_id=$1 ORDER BY created_at DESC LIMIT 3`, [a.id])).rows;
  return { seg, dup, hist, lastClose: lastClose ? lastClose.body : null, corr, sigs, rule, comments };
}

/* the team list is read from Teams management › Responder teams at every call, so a team added by an admin is offered to the model at once */
async function teamCatalog() {
  const rows = await teams.list().catch(() => []);
  return rows.map(t => `${t.key} = ${t.name} [${t.business}, ${t.domain} ${t.level}${t.vendor_id ? ', vendor ' + t.vendor_id : ''}]`).join(' | ') || 'digital-l1 = Salam Digital Ops';
}
async function toTeamKey(label, fallback) {
  const t = await teams.resolve(label).catch(() => null);
  if (t) return t.key;
  const f = await teams.resolve(fallback).catch(() => null);
  return f ? f.key : (fallback || null);
}
const SYSTEM = `You are the incident-triage agent of the Salam Operations Console (telecom digital channels: Mobile MVNO on Rails/17-18 and Fixed FTTH/5G on Node nexus/146, payments via Tap/UPG/HyperPay, OTP via Unifonic, KYC via Nafath/Absher/Semati, BSS Oracle).
You receive ONE open alert with deterministic evidence: what the rule measures, how the same rule behaved in the last 30 days and how it was closed, what fired around the same minute, and the busiest backend error signatures right now.
Output ONLY a JSON object: {"probable_cause":"<= 30 words, concrete","impact":"<= 20 words, who/what is affected","suggested_team":"the KEY of one team from the TEAMS list (e.g. bss-l2), or Unknown","suggested_action":"<= 30 words, the first concrete check or fix","priority_hint":"P1|P2|P3|P4","confidence":0.0-1.0,"is_noise":true|false}
Rules: do not invent numbers; if the evidence says the rule usually self-resolves in minutes and nothing else fired, say so and set is_noise=true; prefer the team that closed it last time; be specific about the endpoint/code when a signature matches the alert.`;

async function triageOne(a, policy) {
  const q = C(); const ev = await evidence(a); const t0 = Date.now();
  // 1) exact duplicate → no model
  if (ev.dup) {
    await q.query(`INSERT INTO agent_triage (alert_id, segment, rule_key, severity, kind, duplicate_of, similar_30d, median_life_min, ms) VALUES ($1,$2,$3,$4,'duplicate',$5,$6,$7,$8) ON CONFLICT (alert_id) DO NOTHING`, [a.id, ev.seg, a.rule_key, a.severity, ev.dup.alert_id, ev.hist.n || 0, ev.hist.med_min || null, Date.now() - t0]);
    let applied = {};
    if (policy.mode === 'assist' && policy.autoResolveDup.includes(a.rule_key)) {
      await q.query(`UPDATE alerts SET status='resolved', resolved_at=now() WHERE id=$1 AND status='open'`, [a.id]); applied = { resolved: true };
      await q.query(`UPDATE agent_triage SET applied=$2 WHERE alert_id=$1`, [a.id, JSON.stringify(applied)]);
    }
    await comment(a.id, `🤖 Agent triage — duplicate of open incident #${ev.dup.alert_id} (same rule, fired within ${CFG.dupWindowMin} min).${applied.resolved ? ' Auto-resolved per policy (rule allow-listed).' : ' Work the original; this one carries no new information.'}`);
    return { kind: 'duplicate', applied };
  }
  // 2) flapping → short note, model still asked (cause matters)
  const flapping = Number(a.reopen_count || 0) >= 3;
  const user = `ALERT #${a.id} · ${a.severity} · ${a.name} (rule ${a.rule_key}, ${ev.seg === 'fixed' ? 'Fixed' : 'Mobile'}) · fired ${a.fired_at} · breaches ${a.breach_count} · re-opens ${a.reopen_count || 0}
Measure: ${a.metric_key} ${a.operator} ${a.threshold} · observed ${a.observed_value} (sample ${a.sample || '?'}, window ${a.window_hours || '?'} h)
Message: ${String(a.message || '').slice(0, 300)}
Rule doc: ${String(ev.rule.description || '-').slice(0, 300)} · class ${ev.rule.alert_class || '?'} · owner team on rule: ${ev.rule.team || a.team || '-'}
Last 30 days, same rule: ${ev.hist.n || 0} incidents, median lifetime ${ev.hist.med_min == null ? '?' : ev.hist.med_min + ' min'}, acknowledged ${ev.hist.acked || 0}, usually handled by ${ev.hist.usual_person || 'nobody recorded'}
Last human note on this rule: ${ev.lastClose ? String(ev.lastClose).slice(0, 200) : 'none'}
Fired within ±10 min: ${ev.corr.length ? ev.corr.map(c => `#${c.id} ${c.severity} ${c.name} (${c.status})`).join('; ') : 'nothing else'}
Busiest backend signatures last 2 h (${ev.seg}): ${ev.sigs.length ? ev.sigs.map(s => `${s.endpoint || s.source} code ${s.code || '-'} ×${s.last_24h} ${s.class || ''}${s.probable_cause ? ' — ' + s.probable_cause : ''}`).join('; ') : 'none recorded'}
Recent comments: ${ev.comments.length ? ev.comments.map(c => `${c.author}: ${String(c.body).slice(0, 120)}`).join(' | ') : 'none'}${flapping ? '\nNOTE: this incident is FLAPPING (re-opened ' + a.reopen_count + ' times).' : ''}`;
  let out = null, j = null;
  /* ONBOARDING FLOW GUARD (29 Sep 2026): the finding IS the cause — a deterministic verdict, no model call, and the
   * incident is assigned to the Mobile digital L2 team whatever the policy says (the rule owner; nothing to guess). */
  const guard = /^onboarding_flow_/.test(String(a.rule_key || ''));
  if (guard) { try { j = await require('./flowGuard').triageFor(a); } catch (e) { log('flow-guard triage failed', a.id, e.message); } }
  if (!guard) try {
    out = await llm.chat({ system: SYSTEM + `\nTEAMS: ${await teamCatalog()}`, user, purpose: 'agent-incident.triage', caller: 'salam-agent-incident', json: true, maxTokens: 320, temperature: 0.1 });
    j = (out.json && typeof out.json === 'object' && (out.json.probable_cause || out.json.suggested_action)) ? out.json : null;
    if (!j) log(`triage #${a.id}: unusable model answer (${out.provider} ${out.model}, ${out.ms} ms, ${String(out.text || '').length} chars${out.jsonError ? ', ' + out.jsonError : ''}): ${String(out.text || '').slice(0, 160).replace(/\s+/g, ' ')}`);
  }
  catch (e) { if (e.llm) throw e; log('triage LLM failed', a.id, e.message); }
  const team = j && j.suggested_team && !/^unknown$/i.test(String(j.suggested_team)) ? await toTeamKey(String(j.suggested_team).slice(0, 60), ev.rule.team || a.team) : await toTeamKey(ev.rule.team || a.team, null);
  await q.query(`INSERT INTO agent_triage (alert_id, segment, rule_key, severity, kind, probable_cause, impact, suggested_team, suggested_action, priority_hint, confidence, similar_30d, median_life_min, usual_close, correlated, top_signatures, model, ms)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (alert_id) DO UPDATE SET
        probable_cause = COALESCE(EXCLUDED.probable_cause, agent_triage.probable_cause),
        impact         = COALESCE(EXCLUDED.impact, agent_triage.impact),
        suggested_team = COALESCE(EXCLUDED.suggested_team, agent_triage.suggested_team),
        suggested_action = COALESCE(EXCLUDED.suggested_action, agent_triage.suggested_action),
        priority_hint  = COALESCE(EXCLUDED.priority_hint, agent_triage.priority_hint),
        confidence     = COALESCE(EXCLUDED.confidence, agent_triage.confidence),
        model = EXCLUDED.model, ms = EXCLUDED.ms,
        attempts = coalesce(agent_triage.attempts,1) + 1, retried_at = now()`,
    [a.id, ev.seg, a.rule_key, a.severity, flapping ? 'flapping' : 'triage', j ? String(j.probable_cause || '').slice(0, 400) : null, j ? String(j.impact || '').slice(0, 300) : null, team, j ? String(j.suggested_action || '').slice(0, 400) : null,
      j ? String(j.priority_hint || '').slice(0, 3) : null, j ? (Number(j.confidence) || null) : null, ev.hist.n || 0, ev.hist.med_min || null, ev.lastClose ? String(ev.lastClose).slice(0, 200) : null,
      JSON.stringify(ev.corr.map(c => ({ id: c.id, name: c.name, severity: c.severity, status: c.status }))), JSON.stringify(ev.sigs), out ? `${out.provider}:${out.model}` : (guard && j ? 'rules:flow-guard' : null), Date.now() - t0]);
  let applied = {};
  if (((policy.mode === 'assist' && policy.autoTeam.includes(a.rule_key)) || guard) && team && !a.team) {
    await q.query(`UPDATE alerts SET team=$2 WHERE id=$1 AND team IS NULL`, [a.id, team]); applied = { team };
    await q.query(`UPDATE agent_triage SET applied=$2 WHERE alert_id=$1`, [a.id, JSON.stringify(applied)]);
  }
  const hist = `${ev.hist.n || 0}× in 30 d${ev.hist.med_min != null ? `, median ${ev.hist.med_min} min` : ''}`;
  const body = j
    ? `🤖 Agent triage (${(Number(j.confidence) * 100 || 0).toFixed(0)} % · ${j.priority_hint || a.severity}${j.is_noise ? ' · likely noise' : ''}${flapping ? ' · flapping' : ''})\nCause: ${j.probable_cause || '-'}\nImpact: ${j.impact || '-'}\nTeam: ${team || '-'}${applied.team ? ' (assigned by policy)' : ''}\nFirst action: ${j.suggested_action || '-'}\nHistory: ${hist}${ev.corr.length ? ` · fired with ${ev.corr.map(c => '#' + c.id).join(' ')}` : ''}`
    : `🤖 Agent triage · measured evidence (the on-prem model gave no answer — Settings › Agents › Self-test says why)\nHistory of this rule: ${hist}${ev.hist.usual_person ? ` · usually handled by ${ev.hist.usual_person}` : ''}${ev.hist.acked != null ? ` · ${ev.hist.acked} acknowledged` : ''}\nOwner team on the rule: ${ev.rule.team || a.team || '-'}${ev.lastClose ? `\nLast human note on this rule: ${String(ev.lastClose).slice(0, 160)}` : ''}${ev.corr.length ? `\nFired within ±10 min of: ${ev.corr.map(c => `#${c.id} ${c.severity} ${c.name}`).join(' · ')}` : ''}${ev.sigs.length ? `\nBusiest backend signatures (2 h): ${ev.sigs.slice(0, 3).map(sg => `${sg.endpoint || sg.source} ${sg.code || ''} ×${sg.last_24h}`).join(' · ')}` : ''}`;
  const bodyOut = guard && j && Array.isArray(j.cases) && j.cases.length
    ? body.replace('🤖 Agent triage (', '🤖 Agent triage · rules, no model (') + `\nCases: ${j.cases.slice(0, 5).map(c => `${c.checkout || c.order} · ${c.cls} · ${c.plan} · ${c.status}${c.inc ? ' · ' + c.inc : ''}`).join(' | ')}\nOwner: Mobile digital L2 (TCS) — assigned from the rule. Mobile › Flow guard holds every case with its evidence.`
    : body;
  /* a retry that still has no model answer must not post the same evidence note again */
  const already = (await q.query(`SELECT count(*)::int n FROM incident_comments WHERE alert_id=$1 AND author='agent'`, [a.id])).rows[0].n;
  if (j || !already) await comment(a.id, bodyOut);
  return { kind: flapping ? 'flapping' : 'triage', model: !!j, applied, retry: already > 0 };
}

/* ---- RULE → TEAM MAPPING (24 Sep 2026) ----
 * Every enabled rule gets a proposed owning team: deterministic first (teams.scoreRule — the team keywords against
 * the rule key / name / metric / description, side-aware), the model only for the ambiguous ones, with the ranked
 * candidates in the prompt so it can only pick from the registry. Proposals land in alert_rule_team_suggestions and
 * WAIT for a human (Alerts › Alert rules › Team mapping): approve writes alert_rules.team and the open incidents of
 * that rule; reject is remembered until the rule changes. Never applied on its own, in any mode. */
const MAP_SYSTEM = `You map an alert rule of the Salam Operations Console (telecom: Mobile MVNO and Fixed FTTH digital channels, BSS Oracle/Siebel/BRM, OSS, payments Tap/UPG/HyperPay, OTP Unifonic, KYC Nafath/Absher) to the ONE responder team that should own incidents of this rule first.
Output ONLY a JSON object: {"team":"<team key from TEAMS>","confidence":0.0-1.0,"reason":"<= 25 words"}
Rules: choose only a key that is in TEAMS; prefer the L2 team of the business side over L1; L3 only for product-defect rules; if truly unclear pick the L1 team with confidence <= 0.4.`;
let mapBusy = false;
async function mapRules({ force = false, maxModel = 15 } = {}) {
  if (mapBusy) return { skipped: true }; mapBusy = true; const q = C(); const t0 = Date.now();
  const run = (await q.query(`INSERT INTO agent_runs (agent) VALUES ('incident.map') RETURNING id`)).rows[0].id;
  const stats = { rules: 0, unchanged: 0, deterministic: 0, modelled: 0, lowConfidence: 0, proposed: 0, errors: 0, modelUnavailable: false };
  try {
    await teams.ensureSchema().catch(() => {});
    const list = await teams.list({ all: false });
    const rules = (await q.query(`SELECT r.*, s.id AS sid, s.status AS sstatus, s.rule_updated_at AS srule_at, s.suggested_team AS ssuggested FROM alert_rules r
        LEFT JOIN alert_rule_team_suggestions s ON s.rule_key=r.key WHERE r.enabled ORDER BY r.severity, r.key`)).rows;
    let modelCalls = 0;
    for (const r of rules) {
      stats.rules++;
      try {
        const stale = !r.sid || force || (r.srule_at && r.updated_at && new Date(r.updated_at) > new Date(r.srule_at));
        if (!stale) { stats.unchanged++; continue; }
        const current = await teams.resolve(r.team);
        const sc = teams.scoreRule(r, list);
        let pick = null, confidence = 0, method = 'rule', reason = '';
        if (sc.top && sc.confident) { pick = sc.top.key; confidence = Math.min(0.95, 0.55 + sc.top.score * 0.08); reason = `keywords: ${sc.top.hits.join(', ')}`; stats.deterministic++; }
        else if (modelCalls < maxModel && !stats.modelUnavailable) {
          modelCalls++;
          const cands = sc.ranked.filter(x => x.score > 0).map(x => `${x.key} (score ${x.score}${x.hits.length ? ': ' + x.hits.join(', ') : ''})`).join('; ') || 'none scored — consider every team';
          const user = `RULE ${r.key} (${sc.seg === 'fixed' ? 'Fixed' : 'Mobile'}) · ${r.name} · severity ${r.severity} · metric ${r.metric_key} · class ${r.alert_class || '?'}
Description: ${String(r.description || '-').slice(0, 300)}
Trigger codes: ${String(r.trigger_codes || '-').slice(0, 120)}
Current owner on the rule: ${current ? current.key : (r.team || 'none')}
Keyword candidates: ${cands}
TEAMS: ${await teamCatalog()}`;
          try {
            const out = await llm.chat({ system: MAP_SYSTEM, user, purpose: 'agent-incident.map', caller: 'salam-agent-incident', json: true, maxTokens: 120, temperature: 0.1 });
            const j = out.json && typeof out.json === 'object' ? out.json : null;
            const t = j && j.team ? await teams.resolve(j.team) : null;
            if (t) { pick = t.key; confidence = Math.max(0.1, Math.min(0.9, Number(j.confidence) || 0.5)); method = 'model'; reason = String(j.reason || '').slice(0, 200); stats.modelled++; }
          } catch (e) { if (e.llm) stats.modelUnavailable = true; log('map: model failed for', r.key, e.message); }
          if (!pick && sc.top) { pick = sc.top.key; confidence = 0.35; method = 'rule'; reason = `weak keyword match: ${sc.top.hits.join(', ')}`; stats.lowConfidence++; }
        } else if (sc.top) { pick = sc.top.key; confidence = 0.35; method = 'rule'; reason = `weak keyword match: ${sc.top.hits.join(', ')}`; stats.lowConfidence++; }
        if (!pick) continue;
        if (current && current.key === pick) {                       // already right — remember that so it is not re-asked
          await q.query(`INSERT INTO alert_rule_team_suggestions (rule_key, segment, current_team, suggested_team, confidence, method, reason, status, rule_updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'applied',$8)
              ON CONFLICT (rule_key) DO UPDATE SET current_team=EXCLUDED.current_team, suggested_team=EXCLUDED.suggested_team, confidence=EXCLUDED.confidence, method=EXCLUDED.method, reason=EXCLUDED.reason, status='applied', rule_updated_at=EXCLUDED.rule_updated_at, updated_at=now()`,
            [r.key, sc.seg, current.key, pick, confidence, method, 'already the owner on the rule', r.updated_at]);
          continue;
        }
        if (r.sid && r.sstatus === 'rejected' && r.ssuggested === pick && !force && !stale) continue;
        await q.query(`INSERT INTO alert_rule_team_suggestions (rule_key, segment, current_team, suggested_team, confidence, method, reason, alternatives, status, rule_updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'proposed',$9)
            ON CONFLICT (rule_key) DO UPDATE SET current_team=EXCLUDED.current_team, suggested_team=EXCLUDED.suggested_team, confidence=EXCLUDED.confidence, method=EXCLUDED.method, reason=EXCLUDED.reason,
              alternatives=EXCLUDED.alternatives, status='proposed', decided_by=NULL, decided_at=NULL, rule_updated_at=EXCLUDED.rule_updated_at, updated_at=now()`,
          [r.key, sc.seg, current ? current.key : (r.team || null), pick, confidence, method, reason, JSON.stringify(sc.ranked.filter(x => x.score > 0 && x.key !== pick).slice(0, 3).map(x => ({ key: x.key, score: x.score }))), r.updated_at]);
        stats.proposed++;
      } catch (e) { stats.errors++; log('map failed', r.key, e.message); }
    }
    await q.query(`UPDATE agent_runs SET finished_at=now(), ok=true, stats=$2 WHERE id=$1`, [run, JSON.stringify(stats)]);
    log(`map: ${stats.rules} rules → ${stats.proposed} proposed (${stats.deterministic} deterministic · ${stats.modelled} model · ${stats.lowConfidence} weak) · ${stats.unchanged} unchanged · ${Date.now() - t0} ms`);
  } catch (e) { log('map failed:', e.message); await q.query(`UPDATE agent_runs SET finished_at=now(), ok=false, error=$2, stats=$3 WHERE id=$1`, [run, e.message, JSON.stringify(stats)]).catch(() => {}); }
  finally { mapBusy = false; }
  return { ...stats, ms: Date.now() - t0 };
}

/* ---- the loop ---- */
let busy = false;
async function tick(limit) {
  if (busy) return { skipped: true }; busy = true; const q = C();
  const run = (await q.query(`INSERT INTO agent_runs (agent) VALUES ('incident') RETURNING id`)).rows[0].id;
  const stats = { checked: 0, triaged: 0, duplicates: 0, flapping: 0, modelled: 0, errors: 0, applied: 0 };
  try {
    const policy = await getPolicy();
    /* RETRY A FAILED TRIAGE (11 Sep 2026). Until today a triage row was written even when the model answered
     * nothing, and the agent skips anything already triaged — so one bad minute left an incident with an
     * "evidence only" note for its whole life, even after the model was fixed. Candidates are now: never triaged,
     * OR triaged WITHOUT a model answer (probable_cause IS NULL) and not retried in the last `retryMin` minutes,
     * capped at `maxRetries` attempts so a genuinely offline model cannot spin. */
    const rows = (await q.query(`SELECT a.* FROM alerts a LEFT JOIN agent_triage t ON t.alert_id=a.id
       WHERE a.status='open' AND a.fired_at >= now() - ($1||' hours')::interval
         AND (t.id IS NULL
              OR (t.probable_cause IS NULL AND coalesce(t.attempts,1) < $3
                  AND coalesce(t.retried_at, t.created_at) < now() - ($4||' minutes')::interval))
       ORDER BY a.severity ASC, a.fired_at DESC LIMIT $2`,
      [String(CFG.lookbackHours), limit || CFG.maxPerTick, CFG.maxRetries, String(CFG.retryMin)])).rows;
    for (const a of rows) {
      stats.checked++;
      try { const r = await triageOne(a, policy); stats[r.kind === 'duplicate' ? 'duplicates' : r.kind === 'flapping' ? 'flapping' : 'triaged']++; if (r.model) stats.modelled++; if (r.applied && Object.keys(r.applied).length) stats.applied++; }
      catch (e) { stats.errors++; log('triage failed', a.id, e.message); if (e.llm) break; }
    }
    await q.query(`UPDATE agent_runs SET finished_at=now(), ok=true, stats=$2 WHERE id=$1`, [run, JSON.stringify(stats)]);
    if (stats.checked) log(`tick: ${stats.checked} open incident(s) → ${stats.triaged} triaged · ${stats.duplicates} duplicate(s) · ${stats.flapping} flapping · ${stats.modelled} with model · ${stats.applied} policy action(s)`);
  } catch (e) { log('tick failed:', e.message); await q.query(`UPDATE agent_runs SET finished_at=now(), ok=false, error=$2, stats=$3 WHERE id=$1`, [run, e.message, JSON.stringify(stats)]).catch(() => {}); }
  finally { busy = false; }
  return stats;
}

async function main() {
  await ensureSchema(); await llm.ensureSchema(); await teams.ensureSchema().catch(e => log('teams schema', e.message)); llm.start();
  if (!CFG.enabled) { log('disabled (AGENT_INCIDENT_ENABLED=0) — idle'); setInterval(() => {}, 3600e3); return; }
  log(`armed: every ${CFG.intervalMin} min · up to ${CFG.maxPerTick} incidents per tick · lookback ${CFG.lookbackHours} h`);
  setTimeout(() => tick(), 15000); setInterval(() => tick(), CFG.intervalMin * 60000);
  /* the refund desk (26 Sep 2026): same process, same model budget — reviews the refund candidates, mails the team,
   * builds the daily approval batch and its incident, reconciles with the proxycms register */
  try { const desk = require('./refundDesk'); await desk.ensureSchema(); desk.start(); } catch (e) { log('refund desk', e.message); }
  /* rule → team proposals: once shortly after boot, then every 6 h (only rules that changed or were never mapped) */
  setTimeout(() => mapRules().catch(e => log('map', e.message)), 60000); setInterval(() => mapRules().catch(e => log('map', e.message)), 6 * 3600e3);
}
if (require.main === module) main().catch(e => { console.error('[AGENT-INC] fatal', e); process.exit(1); });
module.exports = { tick, triageOne, evidence, ensureSchema, getPolicy, setPolicy, mapRules };
