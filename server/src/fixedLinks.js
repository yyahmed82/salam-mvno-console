/* fixedLinks.js — where a FIRING Fixed rule sends the reader (mail digest, PDF report, chat post).
 *
 * The retired Operations Console mailed an "Inspect in console →" deep link per rule
 * (salam-dealer-ops alerts.ts inspectLink: Nafath / Semati → the map pre-filtered to the failing 5G
 * attempts). This is the same idea on the unified console's own routes, extended to every seeded
 * fixed_ rule: #fixed?tab=<key>&<filters> — fixed-map.js reads plans / nafath / semati / outcomes /
 * regions / range from the hash and applies them once (alpha.15).
 *
 * Every Fixed row also links to Fixed › Alerts (rules, history, prod-engine parity) instead of the
 * Mobile #alerts page, so a Fixed-only reader never lands on a page they cannot see. */
'use strict';

const BASE = process.env.CONSOLE_PUBLIC_URL || process.env.CONSOLE_BASE_URL || 'https://salam.sa/unified-console/';
const MAP5G = 'plans=fiveGWhiteLabel,fiveGFWA&range=24h';

const LINKS = {
  fixed_nafath_fail_spike:   { label: 'SDA map — 5G attempts, Nafath not completed', hash: `fixed?tab=map&${MAP5G}&nafath=not_completed` },
  fixed_semati_fail_spike:   { label: 'SDA map — 5G attempts, Semati failed',        hash: `fixed?tab=map&${MAP5G}&semati=failed` },
  fixed_error_spike:         { label: 'Error control board',                         hash: 'fixed?tab=errors' },
  fixed_dealer_timeout_wave: { label: 'Error control board — timeouts',              hash: 'fixed?tab=errors' },
  fixed_dealer_timeout_storm:{ label: 'Error control board — timeouts',              hash: 'fixed?tab=errors' },
  fixed_conversion_drop:     { label: 'SDA map — stalled attempts, 24h',             hash: 'fixed?tab=map&range=24h&outcomes=STALLED' },
  fixed_manafith_denials:    { label: 'SDA map — last 24h',                          hash: 'fixed?tab=map&range=24h' },
  fixed_workhours_drop:      { label: 'SDA map — last 24h',                          hash: 'fixed?tab=map&range=24h' },
  fixed_offhours_activity:   { label: 'SDA map — last 24h',                          hash: 'fixed?tab=map&range=24h' },
  fixed_dealer_stagnation:   { label: 'SDA map — dealers, 7d',                       hash: 'fixed?tab=map&range=7d' },
  fixed_sms_balance_low:     { label: 'Fixed dashboard',                             hash: 'fixed?tab=dash' },
  fixed_ticket_order_api_error: { label: 'Fixed dashboard — incidents',              hash: 'fixed?tab=dash' },
  fixed_ticket_payment_suspend: { label: 'Fixed dashboard — incidents',              hash: 'fixed?tab=dash' },
  fixed_ticket_gateway_system:  { label: 'Fixed dashboard — incidents',              hash: 'fixed?tab=dash' },
  fixed_incident_sla_breach:    { label: 'Fixed dashboard — incidents',              hash: 'fixed?tab=dash' },
};

function isFixed(ev) { return !!ev && (ev.segment === 'fixed' || /^fixed_/.test(String(ev.key || ev.rule_key || ''))); }
function inspect(key) { const l = LINKS[key]; return l ? { label: l.label, url: BASE + '#' + l.hash } : null; }
function alertsUrl() { return BASE + '#fixed?tab=alerts'; }

module.exports = { BASE, isFixed, inspect, alertsUrl, LINKS };
