/* runbook.js — ONE way to split a rule's runbook into steps (11 Sep 2026).
 *
 * Runbooks are written two ways and both must give the same steps everywhere (incident checklist, Guided Response,
 * handover mail, ServiceNow description, ack-SLA reminder):
 *   - one step per line ("1) …\n2) …"), how the rule editor invites you to write them, and
 *   - one paragraph with inline numbering ("1) … 2) … 3) …"), how every builtin rule is seeded (seedRules.js).
 * Splitting on newlines alone turned a seeded runbook into a SINGLE checklist item carrying all four steps.
 * Here: split on newlines AND before an inline "N)" / "N." that has whitespace on both sides — so a decimal
 * ("0.5h", "v1.2") is never a split point — then strip the leading numbering/bullet from each step.
 */
'use strict';
const SPLIT = /\r?\n+|(?=(?:^|\s)\d{1,2}[.)]\s)/;
function steps(rb) {
  return String(rb == null ? '' : rb)
    .split(SPLIT)
    .map(s => s.replace(/^\s*(?:\d{1,2}[.)]|[-*•–])\s*/, '').trim())
    .filter(Boolean);
}
module.exports = { steps, SPLIT };
