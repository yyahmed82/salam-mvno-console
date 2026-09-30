/* On-call escalation — walks open, un-acked incidents up the tier ladder over
 * wall-clock time and pages the next tier via ChatOps (Slack/Teams).
 *
 * Config in console_settings key 'escalation':
 *   { enabled, policies: { P1:[{tier,afterMin}], P2:[...], P3:[...] } }
 *   Each policy is an ordered ladder; a step pages `tier` once `afterMin` real
 *   minutes have elapsed since the incident opened (opened_wall).
 *
 * Timing uses alerts.opened_wall (real now() at insert), NOT the sim clock — so
 * it behaves correctly in both the replay demo and a live replica.
 *
 * An incident stops escalating the moment it is acknowledged, snoozed, or resolved.
 */
const db = require('./db');
const roles = require('./roles');
const chatops = require('./chatops');

const DEFAULT_POLICIES = {
  P1: [ { tier: 'l1_digital', afterMin: 0 }, { tier: 'l2_digital', afterMin: 10 }, { tier: 'l3_digital', afterMin: 25 } ],
  P2: [ { tier: 'l1_bss', afterMin: 0 }, { tier: 'l2_bss', afterMin: 20 }, { tier: 'l2_digital', afterMin: 45 } ],
  P3: [ { tier: 'l1_bss', afterMin: 0 }, { tier: 'l2_bss', afterMin: 60 } ]
};
const DEFAULTS = { enabled: false, policies: DEFAULT_POLICIES };
const WINDOW_MS = 60 * 1000;

const settings = require('./settings');
async function getConfig() {
  const c = (await settings.getSetting('escalation')) || {};
  return { enabled: !!c.enabled, policies: c.policies || DEFAULT_POLICIES };
}
async function setConfig(patch) {
  const cur = await getConfig();
  const next = { ...cur, ...(patch || {}) };
  if (!next.policies || typeof next.policies !== 'object') next.policies = DEFAULT_POLICIES;
  await settings.setSetting('escalation', next);
  return next;
}
async function seedDefaults() {
  const existing = await settings.getSetting('escalation');
  if (!existing) await settings.setSetting('escalation', DEFAULTS);
  return true;
}

// Users currently on-call for a tier role (single `role` or in the `roles[]` array).
async function onCall(tier) {
  try {
    const r = await db.console.query(
      `SELECT email, name FROM console_users
       WHERE enabled=true AND (role=$1 OR $1 = ANY(roles)) ORDER BY name NULLS LAST, email`, [tier]);
    return r.rows;
  } catch (e) { return []; }
}
function mentionText(people, tierLabel) {
  if (!people.length) return `⚠️ no one is assigned to ${tierLabel} — assign a user this role`;
  return people.map(p => '@' + (p.name || p.email)).join(', ');
}

// Highest ladder step whose afterMin has elapsed. Returns index or -1.
function dueStep(ladder, elapsedMin) {
  let idx = -1;
  ladder.forEach((s, i) => { if (elapsedMin >= (Number(s.afterMin) || 0)) idx = i; });
  return idx;
}

/* One evaluation pass. Pass {now, cfg} for tests; otherwise reads live. */
async function tick(inject = {}) {
  const cfg = inject.cfg || await getConfig();
  if (!cfg.enabled) return { skipped: 'disabled', escalated: 0 };
  const now = inject.now ? new Date(inject.now) : new Date();
  const C = db.console;
  const open = (await C.query(
    `SELECT id, rule_key, name, severity, team, metric_key, operator, threshold, observed_value,
            sample, window_hours, message, opened_wall, esc_level
       FROM alerts
      WHERE status='open' AND ack_at IS NULL
        AND (snoozed_until IS NULL OR snoozed_until <= $1)
      ORDER BY id`, [now.toISOString()])).rows;

  const IP = require('./infraAlertsPolicy'); const ipc = await IP.get();
  let escalated = 0; const events = [];
  for (const a of open) {
    if (!ipc.escalation && IP.isInfraKey(a.rule_key || a.metric_key)) continue;   // infra info-only: no ladder
    const ladder = (cfg.policies && cfg.policies[a.severity]) || [];
    if (!ladder.length) continue;
    const opened = a.opened_wall ? new Date(a.opened_wall) : now;
    const elapsedMin = Math.max(0, (now - opened) / 60000);
    const target = dueStep(ladder, elapsedMin);            // index into ladder
    const have = Number(a.esc_level) || 0;                 // steps already paged (count)
    if (target + 1 <= have) continue;                      // nothing new due

    // page every newly-crossed tier (usually one)
    for (let i = have; i <= target; i++) {
      const step = ladder[i];
      const tierLabel = (roles.ROLES[step.tier] && roles.ROLES[step.tier].label) || step.tier;
      const people = await onCall(step.tier);
      const notif = await chatops.notifyIncident(
        { ...a, escTierLabel: tierLabel },
        { kind: 'escalated', force: true, mention: mentionText(people, tierLabel) });
      events.push({ alert: a.id, severity: a.severity, step: i + 1, tier: step.tier, tierLabel,
        onCall: people.map(p => p.email), notified: notif.channels });
    }
    await C.query(`UPDATE alerts SET esc_level=$1, esc_last_at=$2 WHERE id=$3`, [target + 1, now.toISOString(), a.id]);
    escalated++;
  }
  if (escalated) console.log(`[ESCALATION] paged ${escalated} incident(s) at ${now.toISOString()}`);
  return { escalated, events, checked: open.length };
}

let timer = null;
function start() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => { tick().catch(e => console.error('[ESCALATION] tick failed:', e.message)); }, WINDOW_MS);
  tick().catch(() => {});
  console.log('[ESCALATION] scheduler armed (60s)');
  return { armed: true };
}

module.exports = { start, tick, onCall, getConfig, setConfig, seedDefaults, dueStep, DEFAULT_POLICIES, DEFAULTS };
