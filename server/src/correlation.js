/* Alert correlation / root-cause suppression.
 *
 * One upstream outage (e.g. Semati/TCC provider down) makes many rules breach at once.
 * They are all "correct" but they are the SAME incident. This module maps each derived
 * (child) rule to the provider-level ROOT rules that explain it. When a root is currently
 * OPEN, the children are:
 *   - not paged again (ChatOps sends ONE page for the root, not ~10), and
 *   - shown grouped under the root in the UI ("correlated under <root>").
 *
 * We keep this conservative: only rules that are literally the same signal as a root
 * (the Semati provider family) are suppressed. Downstream-but-independent rules
 * (activation/BSS) are only TAGGED as possibly-related, never silenced.
 */

// Provider-level roots, most-authoritative first (used to pick the parent label).
const ROOTS = ['citc_upstream_down', 'semati_hard_down', 'semati_provider_down'];

// child rule key -> the root rule keys that, when open, explain/suppress it
const SUPPRESSED_BY = {
  // same metric as a Semati root, just a lower threshold / different dim
  semati_provider_degraded: ['semati_provider_down', 'semati_hard_down', 'citc_upstream_down'],
  semati_login_down:        ['semati_provider_down', 'semati_hard_down', 'citc_upstream_down'],
  // eligibility-endpoint-scoped signal (where INC0012977 surfaced) — same outage
  semati_eligibility_down:  ['semati_provider_down', 'semati_hard_down', 'citc_upstream_down'],
  // provider-family sub-signals (transport / intermittent / latency) of the same outage
  semati_transport_errors:  ['semati_provider_down', 'semati_hard_down', 'citc_upstream_down'],
  semati_flapping:          ['semati_provider_down', 'semati_hard_down', 'citc_upstream_down'],
  semati_timeouts:          ['semati_provider_down', 'semati_hard_down', 'citc_upstream_down'],
  // MSISDN provisioning fails because the provider is down
  semati_fail_storm:        ['semati_provider_down', 'semati_hard_down', 'citc_upstream_down'],
  semati_fail_spike:        ['semati_provider_down', 'semati_hard_down', 'citc_upstream_down'],
};

// Softer link: page normally, but tag as "possibly related" (could be independent, e.g. a real BSS fault).
const RELATED_TO = {
  activation_fail_storm: ['semati_provider_down', 'semati_hard_down', 'citc_upstream_down'],
  eligibility_deny_spike: ['citc_upstream_down'],
};

// journeys a provider root blocks — shown on the incident so L1 sees blast radius at a glance
// (matches the "Impacted Service" line on the TCC incident tickets, e.g. INC0012977).
const IMPACT = {
  semati_provider_down: ['Activation', 'MNP', 'Eligibility', 'Change Plan', 'SIM Swap'],
  semati_hard_down:     ['Activation', 'MNP', 'Eligibility', 'Change Plan', 'SIM Swap'],
  citc_upstream_down:   ['Activation', 'MNP', 'Eligibility', 'Change Plan', 'SIM Swap', 'Identity (Nafath)'],
};
function impactOf(key) { return IMPACT[key] || null; }

function isRoot(key) { return ROOTS.includes(key); }

// the root keys that currently have an OPEN alert (Set of strings)
async function openRootKeys(C) {
  const keys = new Set();
  try {
    const rows = (await C.query(
      `SELECT DISTINCT rule_key FROM alerts WHERE status='open' AND rule_key = ANY($1)`, [ROOTS])).rows;
    rows.forEach(r => keys.add(r.rule_key));
  } catch (e) {}
  return keys;
}

// If `key` is a child and one of its roots is open, return that root key (else null).
function suppressorOf(key, openRoots) {
  const roots = SUPPRESSED_BY[key];
  if (!roots) return null;
  for (const r of ROOTS) if (roots.includes(r) && openRoots.has(r)) return r;   // most-authoritative first
  return null;
}

// If `key` is a soft-related child and a root is open, return that root key (still pages).
function relatedTo(key, openRoots) {
  const roots = RELATED_TO[key];
  if (!roots) return null;
  for (const r of ROOTS) if (roots.includes(r) && openRoots.has(r)) return r;
  return null;
}

module.exports = { ROOTS, SUPPRESSED_BY, RELATED_TO, IMPACT, isRoot, impactOf, openRootKeys, suppressorOf, relatedTo };
