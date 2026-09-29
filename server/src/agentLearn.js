/* agentLearn.js — HOW AGENT 2 LEARNS AND EARNS AUTONOMY (29 Sep 2026, alpha.117).
 *
 * Until today a 👍/👎 on a triage note was stored and counted (Triage quality tile) but read by nothing — the
 * note of the next incident did not change. This module closes the loop, in three parts:
 *
 *   1. REVIEW QUEUE — every unrated note is shown next to how the incident actually ended (final team, who
 *      resolved it, reason, re-assignments) with a SUGGESTED verdict:
 *        helpful      the suggested team is the team that closed it and nobody re-assigned it
 *        not helpful  the incident was re-assigned away from the suggested team, or closed by another team
 *        n/a          it cleared by itself and nobody touched it — nothing to learn (kept out of the counters)
 *        undecided    still open, or no team on either side — a person decides, or waits
 *      "Confirm all" applies the suggested verdicts in one click (feedback_source = 'review').
 *      IMPLICIT RATING going forward: resolving an incident without changing the team rates its note helpful,
 *      re-assigning it to another team rates it not helpful, re-assigning it TO the suggested team rates it
 *      helpful (feedback_source = 'implicit'). A person's own 👍/👎 always wins (feedback_source = 'human').
 *
 *   2. EXAMPLES IN THE PROMPT — agentIncident.evidence() asks examplesFor(rule): the last 2 helpful notes of
 *      the same rule (cause · action · team) and the last unhelpful one with the team that finally closed it.
 *      The mapper gets the rejected proposals of a rule as "do not propose". Ratings now change the next answer.
 *
 *   3. PROMOTION LADDER — per rule, over the last 30 days: rated notes, % helpful, % team match on resolved
 *      incidents, confirmed duplicates. A rule is READY for
 *        autoTeam        rated >= 10 and team match >= 90 %
 *        autoResolveDup  duplicates rated helpful >= 10 and none rated unhelpful
 *      Promote (a person, audited) adds the rule to the policy allow-list and switches the mode to assist;
 *      Demote removes it. AUTO-DEMOTE (every tick): a promoted rule whose helpful rate over 30 days falls under
 *      70 % with >= 10 ratings is removed from the list, with an audit row and a log line. Nothing is promoted
 *      by itself. The mode names stay: advise = notes only · assist = the allow-listed actions.
 *
 * Only unified_console is written. Thresholds are in THRESH below (env AGENT_LEARN_*). */
'use strict';
const db = require('./db');
const C = () => db.console;
const log = (...a) => console.log(new Date().toISOString(), '[agent-learn]', ...a);

const THRESH = {
  minRated: Number(process.env.AGENT_LEARN_MIN_RATED) || 10,
  teamMatch: Number(process.env.AGENT_LEARN_TEAM_MATCH) || 0.9,
  dupConfirmed: Number(process.env.AGENT_LEARN_DUP_CONFIRMED) || 10,
  demoteBelow: Number(process.env.AGENT_LEARN_DEMOTE_BELOW) || 0.7,
  days: 30
};

async function ensureSchema() {
  const q = C();
  await q.query(`ALTER TABLE agent_triage ADD COLUMN IF NOT EXISTS feedback_source text`);
  await q.query(`ALTER TABLE agent_triage ADD COLUMN IF NOT EXISTS noise boolean`);
  await q.query(`CREATE INDEX IF NOT EXISTS agent_triage_rule_fb ON agent_triage (rule_key, helpful, feedback_at DESC)`);
  await q.query(`CREATE TABLE IF NOT EXISTS agent_rule_promotions (
      id serial PRIMARY KEY, rule_key text NOT NULL, level text NOT NULL, action text NOT NULL, actor text, reason text,
      score jsonb, at timestamptz NOT NULL DEFAULT now())`);
  await q.query(`UPDATE agent_triage SET feedback_source='human' WHERE helpful IS NOT NULL AND feedback_source IS NULL`);
}

/* ---- team equality: keys and legacy labels both appear on alerts.team; resolve through the registry ---- */
async function sameTeam(a, b) {
  if (!a || !b) return false;
  if (String(a).toLowerCase() === String(b).toLowerCase()) return true;
  try { const teams = require('./teams'); const x = await teams.resolve(a), y = await teams.resolve(b); return !!(x && y && x.key === y.key); } catch (_) { return false; }
}

/* ---- the suggested verdict for one (triage, alert) pair — the same function drives the queue and the implicit rating ---- */
async function verdictFor(t, a, { event } = {}) {
  if (!a) return { verdict: 'undecided', why: 'incident not found' };
  if (t.kind === 'duplicate') {
    if (a.status !== 'resolved') return { verdict: 'undecided', why: 'still open' };
    if (a.resolve_reason === 'duplicate') return { verdict: 'helpful', why: 'closed as a duplicate, as the note said' };
    const life = a.resolved_at && a.fired_at ? (new Date(a.resolved_at) - new Date(a.fired_at)) / 60000 : null;
    if (life != null && life <= 120 && (a.resolved_by === 'system' || !a.ack_by)) return { verdict: 'helpful', why: `gone in ${Math.round(life)} min, nobody had to act` };
    if (a.ack_by && a.resolve_reason && a.resolve_reason !== 'duplicate') return { verdict: 'not helpful', why: `a person handled it as "${a.resolve_reason}", not a duplicate` };
    return { verdict: 'undecided', why: 'closed without a reason' };
  }
  if (t.kind === 'flapping') {
    if (a.status !== 'resolved') return { verdict: 'undecided', why: 'still open' };
    return Number(a.reopen_count || 0) >= 3 ? { verdict: 'helpful', why: `re-opened ${a.reopen_count}× — flapping was the point` } : { verdict: 'undecided', why: 'stopped flapping' };
  }
  if (!t.probable_cause) return { verdict: 'n/a', why: 'no model answer in this note — nothing to rate' };
  const sug = t.suggested_team;
  if (event === 'reassign') {
    if (!sug) return { verdict: 'undecided', why: 'the note named no team' };
    return (await sameTeam(sug, a.team)) ? { verdict: 'helpful', why: `moved to ${a.team} — the team the note suggested` } : { verdict: 'not helpful', why: `moved to ${a.team}, the note said ${sug}` };
  }
  if (a.status !== 'resolved') return { verdict: 'undecided', why: 'still open' };
  const touched = !!a.ack_by || (a.resolved_by && a.resolved_by !== 'system') || Number(a.reassign_count || 0) > 0;
  if (!touched) return { verdict: 'n/a', why: `cleared by itself (${a.resolve_reason || 'cleared'}), nobody handled it` };
  if (a.resolve_reason === 'false_positive') return { verdict: t.noise === true ? 'helpful' : 'not helpful', why: t.noise === true ? 'the note called it noise and a person agreed' : 'closed as a false positive — the note treated it as real' };
  if (!sug || !a.team) return { verdict: 'undecided', why: !sug ? 'the note named no team' : 'the incident has no team' };
  const match = await sameTeam(sug, a.team);
  if (match && !Number(a.reassign_count || 0)) return { verdict: 'helpful', why: `closed by ${a.team}, the team the note suggested, no re-assignment` };
  if (match) return { verdict: 'helpful', why: `ended with ${a.team} as the note suggested (after ${a.reassign_count} re-assignment(s))` };
  return { verdict: 'not helpful', why: `closed by ${a.team}, the note said ${sug}` };
}

const ALERT_COLS = `a.id, a.name, a.rule_key, a.severity, a.status, a.team, a.ack_by, a.assignee, a.fired_at, a.resolved_at, a.resolved_by, a.resolve_reason, a.note, a.reopen_count, a.reassign_count, a.segment`;

/* ---- review queue ---- */
async function queue({ days = 30, limit = 400, segment } = {}) {
  const q = C();
  const p = [String(days), limit]; let segW = '';
  if (segment === 'fixed') segW = `AND (a.segment='fixed' OR t.rule_key LIKE 'fixed\\_%')`;
  else if (segment === 'mvno') segW = `AND NOT (a.segment='fixed' OR t.rule_key LIKE 'fixed\\_%')`;
  const rows = (await q.query(`SELECT t.id, t.alert_id, t.kind, t.rule_key, t.severity, t.probable_cause, t.impact, t.suggested_team, t.suggested_action, t.confidence, t.noise, t.model, t.created_at,
        ${ALERT_COLS.replace(/a\.id,/, 'a.id AS aid,')}
      FROM agent_triage t JOIN alerts a ON a.id=t.alert_id
      WHERE t.helpful IS NULL AND t.feedback_source IS NULL AND t.created_at >= now() - ($1||' days')::interval ${segW}
      ORDER BY t.created_at DESC LIMIT $2`, p)).rows;
  const out = [];
  const counts = { helpful: 0, 'not helpful': 0, 'n/a': 0, undecided: 0 };
  for (const r of rows) {
    const v = await verdictFor(r, { ...r, id: r.aid });
    counts[v.verdict] = (counts[v.verdict] || 0) + 1;
    out.push({ ...r, aid: undefined, suggested: v.verdict, why: v.why });
  }
  return { rows: out, counts, total: out.length };
}

/* apply the suggested verdicts: helpful / not helpful → helpful column; n/a → feedback_source='na' (out of the counters) */
async function confirmAll({ actor, days = 30, segment, only } = {}) {
  const { rows } = await queue({ days, limit: 2000, segment });
  const q = C(); const n = { helpful: 0, 'not helpful': 0, 'n/a': 0, skipped: 0 };
  for (const r of rows) {
    if (only && only !== r.suggested) { n.skipped++; continue; }
    if (r.suggested === 'helpful' || r.suggested === 'not helpful') {
      await q.query(`UPDATE agent_triage SET helpful=$2, feedback_by=$3, feedback_at=now(), feedback_source='review' WHERE id=$1 AND helpful IS NULL`, [r.id, r.suggested === 'helpful', actor]);
      n[r.suggested]++;
    } else if (r.suggested === 'n/a') {
      await q.query(`UPDATE agent_triage SET feedback_by=$2, feedback_at=now(), feedback_source='na' WHERE id=$1 AND helpful IS NULL`, [r.id, actor]);
      n['n/a']++;
    } else n.skipped++;
  }
  return n;
}

/* ---- implicit rating hooks (called by /resolve and /reassign in the API; best-effort, never throws) ---- */
async function onIncidentEvent(alertId, event, actor) {
  try {
    const q = C();
    const a = (await q.query(`SELECT ${ALERT_COLS} FROM alerts a WHERE a.id=$1`, [alertId])).rows[0]; if (!a) return null;
    const ts = (await q.query(`SELECT id, kind, probable_cause, suggested_team, noise, feedback_source FROM agent_triage WHERE alert_id=$1 AND helpful IS NULL AND feedback_source IS NULL`, [alertId])).rows;
    const done = [];
    for (const t of ts) {
      const v = await verdictFor(t, a, { event });
      if (v.verdict === 'helpful' || v.verdict === 'not helpful') {
        await q.query(`UPDATE agent_triage SET helpful=$2, feedback_by=$3, feedback_at=now(), feedback_source='implicit' WHERE id=$1 AND helpful IS NULL`, [t.id, v.verdict === 'helpful', actor || 'system']);
        done.push({ id: t.id, helpful: v.verdict === 'helpful', why: v.why });
      } else if (v.verdict === 'n/a') {
        await q.query(`UPDATE agent_triage SET feedback_at=now(), feedback_source='na' WHERE id=$1 AND helpful IS NULL`, [t.id]);
      }
    }
    return done;
  } catch (e) { log('implicit rating failed', alertId, e.message); return null; }
}

/* ---- examples for the prompts ---- */
async function examplesFor(ruleKey) {
  const q = C();
  const good = (await q.query(`SELECT t.probable_cause, t.suggested_action, t.suggested_team, a.resolve_reason, a.note FROM agent_triage t JOIN alerts a ON a.id=t.alert_id
      WHERE t.rule_key=$1 AND t.helpful=true AND t.kind='triage' AND t.probable_cause IS NOT NULL ORDER BY t.feedback_at DESC NULLS LAST LIMIT 2`, [ruleKey]).catch(() => ({ rows: [] }))).rows;
  const bad = (await q.query(`SELECT t.probable_cause, t.suggested_team, a.team AS final_team, a.resolve_reason, a.note FROM agent_triage t JOIN alerts a ON a.id=t.alert_id
      WHERE t.rule_key=$1 AND t.helpful=false AND t.kind='triage' AND t.probable_cause IS NOT NULL ORDER BY t.feedback_at DESC NULLS LAST LIMIT 1`, [ruleKey]).catch(() => ({ rows: [] }))).rows;
  return { good, bad };
}
function examplesText({ good, bad }) {
  const g = good.length ? good.map(x => `cause "${String(x.probable_cause).slice(0, 120)}" · action "${String(x.suggested_action || '').slice(0, 100)}" · team ${x.suggested_team || '-'}${x.note ? ` · closed: ${String(x.note).slice(0, 80)}` : ''}`).join(' || ') : 'none yet';
  const b = bad.length ? bad.map(x => `cause "${String(x.probable_cause).slice(0, 120)}" · team ${x.suggested_team || '-'} — WRONG, ${x.final_team ? 'it was ' + x.final_team : x.resolve_reason || 'a person disagreed'}${x.note ? ` (${String(x.note).slice(0, 80)})` : ''}`).join(' || ') : 'none';
  return `Rated HELPFUL by people on this rule: ${g}\nRated NOT helpful on this rule (avoid): ${b}`;
}
async function rejectedTeamsFor(ruleKey) {
  const q = C();
  return (await q.query(`SELECT DISTINCT suggested_team FROM alert_rule_team_suggestions WHERE rule_key=$1 AND status='rejected'`, [ruleKey]).catch(() => ({ rows: [] }))).rows.map(r => r.suggested_team).filter(Boolean);
}

/* ---- per-rule scores + readiness ---- (team equality goes through the registry — alerts.team still carries legacy labels) */
async function scores({ days = THRESH.days } = {}) {
  const q = C();
  const rules = (await q.query(`SELECT key AS rule_key, name, severity, team AS rule_team FROM alert_rules WHERE enabled`)).rows;
  const rows = (await q.query(`SELECT t.rule_key, t.kind, t.helpful, t.suggested_team, a.team, a.status, a.reassign_count, a.resolved_by, a.ack_by
        FROM agent_triage t JOIN alerts a ON a.id=t.alert_id WHERE t.created_at >= now() - ($1||' days')::interval`, [String(days)])).rows;
  let teams = null; try { teams = require('./teams'); } catch (_) {}
  const cache = new Map();
  const keyOf = async l => { if (!l) return null; const k = String(l).toLowerCase(); if (cache.has(k)) return cache.get(k); let r = k; try { const t = teams && await teams.resolve(l); if (t) r = t.key; } catch (_) {} cache.set(k, r); return r; };
  const by = new Map();
  for (const r of rows) {
    const s = by.get(r.rule_key) || { notes: 0, rated: 0, helpful: 0, unhelpful: 0, resolved_handled: 0, team_match: 0, dups: 0, dup_ok: 0, dup_bad: 0 };
    if (r.kind === 'duplicate') { s.dups++; if (r.helpful === true) s.dup_ok++; else if (r.helpful === false) s.dup_bad++; }
    else if (r.kind === 'triage') {
      s.notes++; if (r.helpful != null) s.rated++; if (r.helpful === true) s.helpful++; else if (r.helpful === false) s.unhelpful++;
      const handled = r.status === 'resolved' && r.suggested_team && r.team && (r.ack_by || (r.resolved_by && r.resolved_by !== 'system'));
      if (handled) { s.resolved_handled++; if ((await keyOf(r.suggested_team)) === (await keyOf(r.team))) s.team_match++; }
    }
    by.set(r.rule_key, s);
  }
  const ai = require('./agentIncident'); const pol = await ai.getPolicy();
  const guard = k => /^onboarding_flow_/.test(k);
  const out = rules.filter(r => by.has(r.rule_key)).map(r => {
    const s = by.get(r.rule_key);
    const helpfulRate = s.rated ? s.helpful / s.rated : null;
    const matchRate = s.resolved_handled ? s.team_match / s.resolved_handled : null;
    const teamReady = guard(r.rule_key) || (s.rated >= THRESH.minRated && matchRate != null && matchRate >= THRESH.teamMatch && helpfulRate != null && helpfulRate >= THRESH.demoteBelow);
    const dupReady = s.dup_ok >= THRESH.dupConfirmed && s.dup_bad === 0 && (helpfulRate == null || helpfulRate >= THRESH.demoteBelow);
    const inTeam = pol.autoTeam.includes(r.rule_key), inDup = pol.autoResolveDup.includes(r.rule_key);
    const atRisk = (inTeam || inDup) && s.rated >= THRESH.minRated && helpfulRate != null && helpfulRate < THRESH.demoteBelow;
    return { ...r, ...s, helpful_rate: helpfulRate, team_match_rate: matchRate, auto_team: inTeam, auto_dup: inDup, ready_team: teamReady && !inTeam, ready_dup: dupReady && !inDup, at_risk: atRisk,
      level: inDup ? 'assist · team + duplicates' : inTeam ? 'assist · team' : 'advise', guard: guard(r.rule_key) };
  }).sort((a, b) => (b.notes + b.dups) - (a.notes + a.dups));
  return { days, thresholds: THRESH, policy: pol, rules: out };
}

async function promote({ ruleKey, level, actor, reason }) {
  const ai = require('./agentIncident'); const pol = await ai.getPolicy();
  const s = (await scores()).rules.find(r => r.rule_key === ruleKey) || null;
  const patch = { mode: 'assist' };
  if (level === 'team') { if (!pol.autoTeam.includes(ruleKey)) patch.autoTeam = pol.autoTeam.concat(ruleKey); }
  else if (level === 'dup') { if (!pol.autoResolveDup.includes(ruleKey)) patch.autoResolveDup = pol.autoResolveDup.concat(ruleKey); }
  else throw new Error('level must be team | dup');
  const out = await ai.setPolicy(patch);
  await C().query(`INSERT INTO agent_rule_promotions (rule_key, level, action, actor, reason, score) VALUES ($1,$2,'promote',$3,$4,$5)`, [ruleKey, level, actor, reason || null, s ? JSON.stringify({ rated: s.rated, helpful_rate: s.helpful_rate, team_match_rate: s.team_match_rate, dup_ok: s.dup_ok }) : null]);
  return out;
}
async function demote({ ruleKey, level, actor, reason }) {
  const ai = require('./agentIncident'); const pol = await ai.getPolicy();
  const patch = {};
  if (level === 'team' || level === 'all') patch.autoTeam = pol.autoTeam.filter(k => k !== ruleKey);
  if (level === 'dup' || level === 'all') patch.autoResolveDup = pol.autoResolveDup.filter(k => k !== ruleKey);
  if (!(patch.autoTeam || pol.autoTeam).length && !(patch.autoResolveDup || pol.autoResolveDup).length) patch.mode = 'advise';   // nothing allow-listed = notes only
  const out = await ai.setPolicy(patch);
  await C().query(`INSERT INTO agent_rule_promotions (rule_key, level, action, actor, reason) VALUES ($1,$2,'demote',$3,$4)`, [ruleKey, level, actor, reason || null]);
  return out;
}
/* every tick: a promoted rule whose helpful rate fell under the floor loses its autonomy, with a row a person can see */
async function autoDemote() {
  const s = await scores(); const hit = [];
  for (const r of s.rules) if (r.at_risk) {
    await demote({ ruleKey: r.rule_key, level: 'all', actor: 'agent', reason: `helpful ${Math.round(r.helpful_rate * 100)} % over ${s.days} d (${r.rated} rated) is under the ${Math.round(THRESH.demoteBelow * 100)} % floor` });
    log(`auto-demoted ${r.rule_key}: helpful ${Math.round(r.helpful_rate * 100)} % on ${r.rated} rated`);
    hit.push(r.rule_key);
  }
  return hit;
}
async function history(limit = 50) { return (await C().query(`SELECT * FROM agent_rule_promotions ORDER BY at DESC LIMIT $1`, [limit])).rows; }

/* one-line summary for mission control and the daily report */
async function summary() {
  const q = C();
  const fb = (await q.query(`SELECT count(*) FILTER (WHERE helpful IS NULL AND feedback_source IS NULL AND created_at >= now() - interval '30 days')::int AS awaiting,
      count(*) FILTER (WHERE helpful)::int AS helpful, count(*) FILTER (WHERE helpful=false)::int AS unhelpful,
      count(*) FILTER (WHERE feedback_source='implicit' AND feedback_at >= now() - interval '24 hours')::int AS implicit24,
      count(*) FILTER (WHERE feedback_source='review' AND feedback_at >= now() - interval '24 hours')::int AS review24 FROM agent_triage`)).rows[0];
  const s = await scores();
  return { ...fb, ready: s.rules.filter(r => r.ready_team || r.ready_dup).map(r => ({ rule_key: r.rule_key, name: r.name, team: r.ready_team, dup: r.ready_dup })),
    promoted: s.rules.filter(r => r.auto_team || r.auto_dup).length, at_risk: s.rules.filter(r => r.at_risk).map(r => r.rule_key), mode: s.policy.mode };
}

module.exports = { ensureSchema, THRESH, queue, confirmAll, onIncidentEvent, verdictFor, examplesFor, examplesText, rejectedTeamsFor, scores, promote, demote, autoDemote, history, summary };
