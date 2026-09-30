/* segment.js — ONE definition of "which business does this alert / rule belong to", used by the API, the alert
 * mail and the pages. Two businesses, two teams, never mixed:
 *   'mvno'  = Mobile (MVNO)  ← console_users.business 'mobile' | 'both'
 *   'fixed' = Fixed (FTTH · 5G home · e-purchase · Salam Home app) ← console_users.business 'fixed' | 'both'
 * Source of truth = alert_rules.segment / alerts.segment; the fixed_* key prefix is honoured as a fallback so a rule
 * created before the column existed can never leak into the Mobile side (schema.sql backfills it at boot). */
'use strict';
const SEGMENTS = ['mvno', 'fixed'];
const LABEL = { mvno: 'Mobile (MVNO)', fixed: 'Fixed' };
const SHORT = { mvno: 'Mobile', fixed: 'Fixed' };
const BUSINESS_OF = { mvno: 'mobile', fixed: 'fixed' };          // console_users.business value that owns the segment
function segOf(x) {
  if (!x) return 'mvno';
  if (x.segment === 'fixed') return 'fixed';
  const key = String(x.key || x.rule_key || x.metric_key || '');
  return /^fixed_/.test(key) ? 'fixed' : 'mvno';
}
/* which segment a request may see: mobile-only users → mvno, fixed-only → fixed, both → whatever was asked (default mvno) */
function forRequest(req, asked) {
  const b = (req && req.business) || 'both';
  if (b === 'fixed') return 'fixed';
  if (b === 'mobile') return 'mvno';
  return asked === 'fixed' ? 'fixed' : asked === 'all' ? 'all' : 'mvno';
}
/* SQL predicate on a table alias whose rows carry segment + a key column */
function sqlWhere(alias, keyCol, seg) {
  if (seg === 'all') return 'TRUE';
  return seg === 'fixed' ? `(${alias}.segment = 'fixed' OR ${alias}.${keyCol} LIKE 'fixed\\_%')`
                         : `(${alias}.segment <> 'fixed' AND ${alias}.${keyCol} NOT LIKE 'fixed\\_%')`;
}
/* SCOPE (1 Oct 2026): the infrastructure rules (infra_* / fixed_infra_*) live under Infrastructure › Alerts, the business
 * rules under Mobile / Fixed › Alerts. 'infra' keeps only infra keys, 'app' drops them, anything else = no filter
 * (mails, digests, agents and every other caller keep seeing everything). */
function scopeSql(alias, keyCol, scope) {
  if (scope === 'infra') return ` AND ${alias}.${keyCol} LIKE '%infra\\_%'`;
  if (scope === 'app') return ` AND ${alias}.${keyCol} NOT LIKE '%infra\\_%'`;
  return '';
}
/* can a user with this console_users.business receive / see this segment? */
const userSees = (business, seg) => business === 'both' || business === BUSINESS_OF[seg];
module.exports = { SEGMENTS, LABEL, SHORT, BUSINESS_OF, segOf, forRequest, sqlWhere, scopeSql, userSees };
