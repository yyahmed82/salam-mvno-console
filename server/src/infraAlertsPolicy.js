/* infraAlertsPolicy.js — INFRASTRUCTURE ALERTS: INFO-ONLY OR FULL FLOW (1 Oct 2026).
 * The infra_* / fixed_infra_* rules are new: the hosts are still being wired (keys, passerelles, real ports) and the
 * numbers are not yet trustworthy enough to page L1. Until they are, the infra incidents keep the SAME flow in the
 * console (fire, guide, ack, resolve, evidence, history) but the OUTBOUND side is switchable, per channel:
 *   mail        — the "alert fired" digest mail (notify.sendAlertDigest)
 *   chat        — Teams / Slack / WhatsApp post on open (chatops.notifyIncident)
 *   reminders   — the ACK-SLA reminder mails and the "unacknowledged beyond SLA" banner (ackSla)
 *   escalation  — the on-call ladder / management escalation (escalation.tick)
 * Default = everything OFF (info-only). Console Settings › Notifications & escalation › Infrastructure alerts.
 * Setting key `infra_alerts` in console_settings; cached 20 s so the ticks do not hit the DB per alert. */
'use strict';
const settings = require('./settings');
const DEFAULTS = { mail: false, chat: false, reminders: false, escalation: false, note: 'info-only while the hosts are being wired' };
const isInfraKey = k => /(^|_)infra_/.test(String(k || ''));
let cache = null, cacheAt = 0;
async function get() {
  if (cache && Date.now() - cacheAt < 20000) return cache;
  const v = (await settings.getSetting('infra_alerts')) || {};
  cache = { ...DEFAULTS, ...v }; cacheAt = Date.now(); return cache;
}
async function set(patch) {
  const cur = await get(); const next = { ...cur };
  for (const k of ['mail', 'chat', 'reminders', 'escalation']) if (patch[k] != null) next[k] = !!patch[k];
  if (patch.note != null) next.note = String(patch.note).slice(0, 200);
  await settings.setSetting('infra_alerts', next); cache = next; cacheAt = Date.now(); return next;
}
/* true when this alert / rule must stay quiet on that channel */
async function quiet(ruleKey, channel) { if (!isInfraKey(ruleKey)) return false; const c = await get(); return !c[channel]; }
const infoOnly = c => !c.mail && !c.chat && !c.reminders && !c.escalation;
module.exports = { get, set, quiet, isInfraKey, infoOnly, DEFAULTS };
