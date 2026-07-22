/* Built-in analytics dashboards — mirror the Salam Grafana boards + more. */
let _id = 0;
const P = (title, viz, dataset, metric, x = {}) => ({
  id: 'p' + (++_id), title, viz, dataset, metric,
  w: x.w || 6, bucket: x.bucket || (viz === 'stat' ? 'stat' : viz === 'table' ? 'none' : viz === 'pie' || viz === 'donut' ? 'pie' : 'hour'),
  groupBy: x.groupBy || null, filters: x.filters || {}, compare: x.compare || null
});

const DASHBOARDS = [
  // 1 — Overview
  { key: 'overview', name: 'Overview', builtin: true, spec: { filters: {}, panels: [
    P('Orders (24h)', 'stat', 'onboarding', 'count', { w: 3 }),
    P('Activated orders', 'stat', 'onboarding', 'activated', { w: 3 }),
    P('Payment success · all', 'stat', 'payments', 'success_rate', { w: 3 }),
    P('Delivery fail rate', 'stat', 'delivery', 'fail_rate', { w: 3 }),
    P('Orders over time', 'line', 'onboarding', 'count', { bucket: 'hour', groupBy: 'channel', w: 8 }),
    P('Orders by flow', 'bar', 'onboarding', 'count', { bucket: 'day', groupBy: 'flow', w: 4 })
  ] } },
  // 2 — Onboarding funnel: New SIM
  { key: 'funnel_newsim', name: 'Funnel · New SIM', builtin: true, spec: { filters: { number_order_type: '0' }, panels: [
    P('New SIM orders', 'stat', 'onboarding', 'count', { w: 3, filters: { number_order_type: '0' } }),
    P('Eligibility pass', 'stat', 'onboarding', 'eligible', { w: 3, filters: { number_order_type: '0' } }),
    P('Completed (paid)', 'stat', 'onboarding', 'completed', { w: 3, filters: { number_order_type: '0' } }),
    P('Activated orders', 'stat', 'onboarding', 'activated', { w: 3, filters: { number_order_type: '0' } }),
    P('Funnel drop-off', 'funnel', 'onboarding', 'count', { w: 6, filters: { number_order_type: '0' } }),
    P('By SIM type', 'bar', 'onboarding', 'activated', { bucket: 'day', groupBy: 'sim', w: 6, filters: { number_order_type: '0' } }),
    P('Conversion over time', 'line', 'onboarding', 'conversion', { bucket: 'hour', w: 6, filters: { number_order_type: '0' } })
  ] } },
  // 3 — Onboarding funnel: MNP
  { key: 'funnel_mnp', name: 'Funnel · MNP', builtin: true, spec: { filters: { number_order_type: '1' }, panels: [
    P('MNP orders', 'stat', 'onboarding', 'count', { w: 3, filters: { number_order_type: '1' } }),
    P('Eligibility pass', 'stat', 'onboarding', 'eligible', { w: 3, filters: { number_order_type: '1' } }),
    P('Completed (paid)', 'stat', 'onboarding', 'completed', { w: 3, filters: { number_order_type: '1' } }),
    P('Activated orders', 'stat', 'onboarding', 'activated', { w: 3, filters: { number_order_type: '1' } }),
    P('Funnel drop-off', 'funnel', 'onboarding', 'count', { w: 6, filters: { number_order_type: '1' } }),
    P('By SIM type', 'bar', 'onboarding', 'activated', { bucket: 'day', groupBy: 'sim', w: 6, filters: { number_order_type: '1' } }),
    P('Conversion over time', 'line', 'onboarding', 'conversion', { bucket: 'hour', w: 6, filters: { number_order_type: '1' } })
  ] } },
  // 4 — Activation trends (today vs yesterday)
  { key: 'activation', name: 'Activation Trends', builtin: true, spec: { filters: {}, panels: [
    P('New SIM vs MNP — hourly', 'line', 'onboarding', 'activated', { bucket: 'hour', groupBy: 'channel', w: 6 }),
    P('New SIM vs MNP — daily', 'line', 'onboarding', 'activated', { bucket: 'day', groupBy: 'channel', w: 6 }),
    P('MainSIM activation — today vs yesterday', 'line', 'onboarding', 'activated', { bucket: 'hour', w: 6, filters: { number_order_type: '0' }, compare: 'prev' }),
    P('MNP activation — today vs yesterday', 'line', 'onboarding', 'activated', { bucket: 'hour', w: 6, filters: { number_order_type: '1' }, compare: 'prev' })
  ] } },
  // 5 — Activation success & health
  { key: 'activation_success', name: 'Activation Success', builtin: true, spec: { filters: {}, panels: [
    P('Activation success rate (new-line)', 'stat', 'activation', 'newline_success_rate', { w: 4 }),
    P('Semati success rate', 'stat', 'activation', 'semati_success_rate', { w: 4 }),
    P('Nafath completed', 'stat', 'nafath', 'completed', { w: 4 }),
    P('Success rate over time', 'line', 'activation', 'success_rate', { bucket: 'hour', w: 8 }),
    P('By platform', 'bar', 'activation', 'ok', { bucket: 'day', groupBy: 'platform', w: 4 })
  ] } },
  // 6 — Error codes (New Line) — pies
  { key: 'error_codes', name: 'Error Codes · New Line', builtin: true, spec: { filters: {}, panels: [
    P('Activation error codes', 'pie', 'activation', 'failed', { groupBy: 'status_code', w: 6, filters: { state: 'false' } }),
    P('Nafath outcomes', 'pie', 'nafath', 'count', { groupBy: 'status', w: 6 }),
    P('Failed activations over time', 'line', 'activation', 'failed', { bucket: 'hour', w: 6 }),
    P('Errors by API', 'bar', 'activation', 'failed', { bucket: 'day', groupBy: 'api', w: 6, filters: { state: 'false' } })
  ] } },
  // 7 — Payments
  { key: 'payments', name: 'Payments', builtin: true, spec: { filters: {}, panels: [
    P('Success rate · onboarding', 'stat', 'payments', 'success_rate', { w: 3, filters: { payment_on_type: 'OnboardingOrder' } }),
    P('Transactions', 'stat', 'payments', 'count', { w: 3 }),
    P('Amount (SAR)', 'stat', 'payments', 'amount', { w: 3 }),
    P('Failure rate', 'stat', 'payments', 'fail_rate', { w: 3 }),
    P('Payments over time', 'line', 'payments', 'count', { bucket: 'hour', groupBy: 'status', w: 6 }),
    P('Failure rate over time', 'line', 'payments', 'fail_rate', { bucket: 'hour', w: 6 }),
    P('Gateway volume — hourly', 'line', 'payments', 'count', { bucket: 'hour', groupBy: 'vendor', w: 6 }),
    P('Gateway success rate — hourly', 'line', 'payments', 'success_rate', { bucket: 'hour', groupBy: 'vendor', w: 6 }),
    P('By vendor', 'bar', 'payments', 'count', { bucket: 'day', groupBy: 'vendor', w: 6 }),
    P('Decline reasons (code · message)', 'pie', 'payments', 'failed', { groupBy: 'decline', w: 12, filters: { status: 'fail' } })
  ] } },
  // 8 — SIM swap / replacement
  { key: 'sim_swap', name: 'SIM Swap / Replacement', builtin: true, spec: { filters: { checkout_type: '3' }, panels: [
    P('Replacement checkouts', 'stat', 'checkouts', 'count', { w: 4, filters: { checkout_type: '3' } }),
    P('Completed', 'stat', 'checkouts', 'completed', { w: 4, filters: { checkout_type: '3' } }),
    P('Completion rate', 'stat', 'checkouts', 'completion_rate', { w: 4, filters: { checkout_type: '3' } }),
    P('Replacements over time — today vs yesterday', 'line', 'checkouts', 'count', { bucket: 'hour', w: 12, filters: { checkout_type: '3' }, compare: 'prev' })
  ] } },
  // 9 — Change Plan (grouped under Onboarding in the nav)
  { key: 'plan_change', name: 'Change Plan', builtin: true, spec: { filters: {}, panels: [
    P('Requests', 'stat', 'change_plan', 'count', { w: 3 }),
    P('Success', 'stat', 'change_plan', 'success', { w: 3 }),
    P('Failure rate', 'stat', 'change_plan', 'fail_rate', { w: 3 }),
    P('Over time', 'line', 'change_plan', 'count', { bucket: 'hour', w: 6 }),
    P('Failure rate over time', 'line', 'change_plan', 'fail_rate', { bucket: 'hour', w: 6 }),
    P('Top target plans', 'bar', 'change_plan', 'count', { bucket: 'day', groupBy: 'to_plan', w: 6 })
  ] } },
  // 9b — Transfer Ownership (ownership Checkout, checkout_type = 5) — grouped under Onboarding
  { key: 'transfer_ownership', name: 'Transfer Ownership', builtin: true, spec: { filters: { checkout_type: '5' }, panels: [
    P('Ownership requests', 'stat', 'checkouts', 'count', { w: 3, filters: { checkout_type: '5' } }),
    P('Completed', 'stat', 'checkouts', 'completed', { w: 3, filters: { checkout_type: '5' } }),
    P('Completion rate', 'stat', 'checkouts', 'completion_rate', { w: 3, filters: { checkout_type: '5' } }),
    P('Over time — today vs yesterday', 'line', 'checkouts', 'count', { bucket: 'hour', w: 9, filters: { checkout_type: '5' }, compare: 'prev' }),
    P('Completion over time', 'line', 'checkouts', 'completion_rate', { bucket: 'hour', w: 6, filters: { checkout_type: '5' } })
  ] } },
  // 10 — Delivery
  { key: 'delivery', name: 'Delivery', builtin: true, spec: { filters: {}, panels: [
    P('Shipments', 'stat', 'delivery', 'count', { w: 4 }),
    P('Delivered', 'stat', 'delivery', 'delivered', { w: 4 }),
    P('Fail / return rate', 'stat', 'delivery', 'fail_rate', { w: 4 }),
    P('By vendor', 'bar', 'delivery', 'count', { bucket: 'day', groupBy: 'vendor', w: 6 }),
    P('States', 'pie', 'delivery', 'count', { groupBy: 'state', w: 6 })
  ] } },
  // 11 — Eligibility
  { key: 'eligibility', name: 'Eligibility', builtin: true, spec: { filters: {}, panels: [
    P('Eligibility pass rate', 'stat', 'onboarding', 'eligibility_rate', { w: 4 }),
    P('Eligibility pass over time', 'line', 'onboarding', 'eligibility_rate', { bucket: 'hour', groupBy: 'channel', w: 8 }),
    P('Pass by SIM type', 'bar', 'onboarding', 'eligible', { bucket: 'day', groupBy: 'sim', w: 6 }),
    P('Orders by flow', 'bar', 'onboarding', 'count', { bucket: 'day', groupBy: 'flow', w: 6 })
  ] } },
  // 12 — Integration health
  { key: 'integrations', name: 'Integration Health', builtin: true, spec: { filters: {}, panels: [
    P('Nafath failure rate', 'line', 'nafath', 'fail_rate', { bucket: 'hour', w: 6 }),
    P('Semati success rate', 'line', 'activation', 'success_rate', { bucket: 'hour', groupBy: 'semati', w: 6 }),
    P('Delivery fail/return rate', 'line', 'delivery', 'fail_rate', { bucket: 'hour', groupBy: 'vendor', w: 6 })
  ] } },
  // 13 — Channels & devices
  { key: 'channels', name: 'Channels & Devices', builtin: true, spec: { filters: {}, panels: [
    P('Payments by platform', 'pie', 'payments', 'count', { groupBy: 'platform', w: 6 }),
    P('Payments by card type', 'pie', 'payments', 'count', { groupBy: 'card_type', w: 6 }),
    P('Payments by type', 'pie', 'payments', 'count', { groupBy: 'type', w: 6 }),
    P('Orders by flow (channel)', 'bar', 'onboarding', 'count', { bucket: 'day', groupBy: 'flow', w: 6 }),
    P('Incomplete / stuck orders', 'incomplete', 'onboarding', 'count', { w: 12, limit: 40 }),
    P('SIM mix', 'pie', 'onboarding', 'count', { groupBy: 'sim', w: 6 })
  ] } }
];

module.exports = { DASHBOARDS };
