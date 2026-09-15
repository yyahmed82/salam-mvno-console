/* Vendor/contracts reference model.
 *
 * This is deliberately stored as a console setting for phase 1: no migration,
 * no write-path dependency, and no impact on the existing ACK-SLA or SLO engines.
 */
const settings = require('./settings');

const CONFIG_KEY = 'vendor_contracts';

const clone = v => JSON.parse(JSON.stringify(v));
const isoNow = () => new Date().toISOString();
const text = (v, max = 500, fb = '') => String(v == null ? fb : v).trim().slice(0, max);
const arr = v => Array.isArray(v) ? v : [];

const SIGMA_ESCALATION_POLICY = {
  P1: { reminder1Min: 10, reminder2Min: 20, reminder3Min: 40, repeat3Min: 60, informManagement: true },
  P2: { reminder1Min: 15, reminder2Min: 30, reminder3Min: 60, repeat3Min: 120, informManagement: true },
  P3: { reminder1Min: 30, reminder2Min: 120, reminder3Min: 240, repeat3Min: 0, informManagement: false },
  P4: { reminder1Min: 60, reminder2Min: 240, reminder3Min: 480, repeat3Min: 0, informManagement: false }
};

const TCS_ESCALATION_POLICY = {
  P1: { reminder1Min: 15, reminder2Min: 30, reminder3Min: 60, repeat3Min: 60, informManagement: true },
  P2: { reminder1Min: 30, reminder2Min: 60, reminder3Min: 120, repeat3Min: 120, informManagement: true },
  P3: { reminder1Min: 120, reminder2Min: 240, reminder3Min: 480, repeat3Min: 0, informManagement: false },
  P4: { reminder1Min: 480, reminder2Min: 1440, reminder3Min: 2880, repeat3Min: 0, informManagement: false }
};

const escalationItem = (obligationId, policy, message) => ({
  obligationId,
  enabled: true,
  severityPolicy: clone(policy),
  ownerHint: 'L1 -> L2/vendor owner -> service delivery -> management',
  message
});

const evidenceMap = (id, obligationId, sources, primarySource, metric, calculation, surface, readiness, confidence, controls, nextStep) => ({
  id,
  obligationId,
  sources,
  primarySource,
  metric,
  calculation,
  surface,
  readiness,
  confidence,
  controls,
  nextStep
});

const rolloutSurface = (id, title, vendors, businessScope, audience, surfaces, mode, status, shows, evidenceSources, gate, controls) => ({
  id,
  title,
  vendors,
  businessScope,
  audience,
  surfaces,
  mode,
  status,
  shows,
  evidenceSources,
  gate,
  controls
});

const penaltyRule = (id, vendorId, contractId, obligationId, opts = {}) => ({
  id,
  vendorId,
  contractId,
  obligationId,
  enabled: opts.enabled !== false,
  mode: opts.mode || 'estimate_only',
  calculationMethod: opts.calculationMethod || 'eligible_fee_x_weight_x_breach_factor',
  eligibleFeeBasis: opts.eligibleFeeBasis || 'Monthly in-scope managed-service fee for this contract; enter/validate with commercial owner.',
  monthlyCapPercent: opts.monthlyCapPercent == null ? null : opts.monthlyCapPercent,
  capBasis: opts.capBasis || 'Apply the contract monthly cap after summing validated penalty candidates.',
  weightPercent: opts.weightPercent == null ? null : opts.weightPercent,
  severityWeights: opts.severityWeights || null,
  breachFactor: opts.breachFactor || '1.0 for each validated monthly SLA miss until the contract tiering table is confirmed.',
  statusFlow: ['informational', 'candidate_breach', 'validated_breach', 'excluded', 'approved_governance', 'approved_penalty'],
  evidenceRequired: opts.evidenceRequired || ['Measured SLA result', 'Source evidence link', 'Vendor owner confirmation', 'Clock-stop/exclusion review'],
  exclusions: opts.exclusions || ['approved maintenance', 'third-party dependency outside vendor control', 'force majeure', 'customer/client delay', 'approved clock-stop'],
  approvalRequired: opts.approvalRequired || ['SLA owner', 'Vendor owner', 'Commercial/legal owner'],
  approvalStatus: opts.approvalStatus || 'commercial_validation_required',
  notes: opts.notes || 'Reference estimate only; not enforceable until the contract clause, invoice base and exclusions are approved.'
});

const DEFAULT_CONFIG = {
  version: 3,
  sourceNote: 'Reference data extracted from Sigma signed contract and TCS MVNO managed-services proposal. Confirm final legal/contract dates and contacts before using for formal penalty calculation.',
  phases: [
    {
      id: 'phase-1',
      title: 'Vendor Registry',
      status: 'ready',
      outcome: 'A single super-admin page lists vendors, contracts, business scope, domains, support windows, contacts, and escalation notes.',
      riskControl: 'Reference-only data; no live alert behavior changes.'
    },
    {
      id: 'phase-2',
      title: 'SLA / SLO Obligation Catalog',
      status: 'ready',
      outcome: 'Contractual response, restoration, resolution, availability, performance, RCA, resource, and governance targets are captured per vendor.',
      riskControl: 'Stored separately from current dashboard SLO config; existing SLO cards continue using /api/slo/config.'
    },
    {
      id: 'phase-3',
      title: 'Default Targets & Messages',
      status: 'ready',
      outcome: 'Sigma and TCS are seeded with practical defaults for Mobile, Fixed, Digital, BSS, OSS, and ITSM reference.',
      riskControl: 'Defaults can be reset from the page; edits are audited and persisted in console_settings only.'
    },
    {
      id: 'phase-4',
      title: 'Evidence Connectors',
      status: 'ready',
      outcome: 'Each obligation has an explicit evidence mapping: live ACK/alert facts first, partial APIGW/OSB/rollup facts where available, and planned ITSM/vendor-report facts where the source is not wired yet.',
      riskControl: 'Evidence stays read-only and carries a confidence label. Planned/partial connectors can inform operators but cannot trigger penalties or vendor paging.'
    },
    {
      id: 'phase-5',
      title: 'Operational Rollout',
      status: 'ready',
      outcome: 'Vendor SLA messages are mapped to SLA dashboard, Yusr, incident details, Customer 360, monitoring, test mails, and monthly governance packs in informational mode.',
      riskControl: 'Rollout is informational by default. Enforcement, penalties, and real vendor paging remain locked until UAT, evidence confidence review, and vendor-owner sign-off.'
    }
  ],
  vendors: [
    {
      id: 'sigma',
      name: 'Sigma',
      legalName: 'SIGMA',
      type: 'Managed services / operations',
      businessScope: ['fixed', 'mobile'],
      domains: ['OSS', 'ITSM', 'DMS', 'Big data', 'Infrastructure', 'GIS', 'Remedy'],
      supportWindow: 'L1 24x7; L2 business hours with on-call for urgent/critical incidents.',
      contractStatus: 'reference',
      contacts: [],
      escalation: [
        'P1/P2: acknowledge immediately per response SLA and escalate to L2/L3/vendor where needed.',
        'Use approved clock-stop only for third-party, planned downtime, or customer/client dependency delays.'
      ],
      notes: 'Scope includes Zsmart OSS, GIS, Remedy, DMS, Big Data, infrastructure support and service-level reporting.'
    },
    {
      id: 'tcs',
      name: 'TCS',
      legalName: 'Tata Consultancy Services',
      type: 'MVNO IT operations managed services',
      businessScope: ['mobile'],
      domains: ['Digital', 'BSS', 'OSS', 'ITSM', 'API Gateway', 'Payments', 'MNP'],
      supportWindow: 'L1 24x7; L2 application 16x7 office plus on-call; L2 infrastructure/ITSM 16x5 plus on-call for P1/P2.',
      contractStatus: 'proposal/reference',
      contacts: [],
      escalation: [
        'P1/P2 incidents have on-call support outside office hours.',
        'Third-party, OEM, hardware, application bugs outside TCS control, planned downtime, and force majeure are excluded per proposal assumptions.'
      ],
      notes: 'Scope covers DMS, Digital Apps, Web Portal, payment gateways, Kong API Gateway and NetAxis MNP integration. Optiva BSS/OSS support after 31 Jan 2026 is excluded in the proposal.'
    }
  ],
  contracts: [
    {
      id: 'sigma-2024',
      vendorId: 'sigma',
      title: 'CONT-SALAM-167-2024 Sigma signed contract',
      businessScope: ['fixed', 'mobile'],
      domains: ['OSS', 'ITSM', 'DMS', 'Big data', 'Infrastructure', 'GIS', 'Remedy'],
      sourceDoc: 'CONT-SALAM-167-2024_Signed_Stmpd_SIGMA.pdf',
      sourcePages: 'Service scope p21-p23; SLA p93-p98; responsibility matrix p101-p102',
      effectiveFrom: '2024',
      effectiveTo: null,
      status: 'active/reference',
      eligibleMonthlyFeeSar: null,
      monthlyPenaltyCapPercent: null,
      penaltyMode: 'estimate_only',
      penaltyCap: 'Contractual penalties apply by SLA item/impact weighting; validate with commercial/legal owner before formal use.'
    },
    {
      id: 'tcs-2026-mvno-itops',
      vendorId: 'tcs',
      title: 'TCS Technical Proposal for MVNO IT Operations Managed Services 2026',
      businessScope: ['mobile'],
      domains: ['Digital', 'BSS', 'OSS', 'ITSM', 'API Gateway', 'Payments', 'MNP'],
      sourceDoc: 'TCS Technical Proposal To Salam for MVNO IT Opearations Managed Services_2026.pdf',
      sourcePages: 'Scope p13-p15; response/restoration/RCA/availability/performance p44-p50',
      effectiveFrom: '2026',
      effectiveTo: null,
      status: 'proposal/reference',
      eligibleMonthlyFeeSar: null,
      monthlyPenaltyCapPercent: 5,
      penaltyMode: 'estimate_only',
      penaltyCap: 'Response SLA table notes a 5% monthly invoice penalty cap; confirm final contract before enforcement.'
    }
  ],
  obligations: [
    {
      id: 'sigma-response',
      vendorId: 'sigma',
      contractId: 'sigma-2024',
      category: 'incident_response',
      title: 'Incident response',
      appliesTo: { business: ['fixed', 'mobile'], domains: ['OSS', 'ITSM', 'DMS', 'Infrastructure'] },
      target: { P1: '10 min', P2: '15 min', P3: '30 min', P4: '1 hour' },
      attainmentTarget: '99%',
      weight: '1%',
      operatorMessages: {
        met: 'Sigma response is within SLA.',
        warning: 'Sigma response is close to SLA; watch acknowledgement and assignment time.',
        breached: 'Sigma response SLA breached; validate priority, clock-stop reason, and escalation trail.'
      },
      evidencePlan: ['alerts.ack_at - alerts.fired_at', 'Remedy/ITSM incident timestamps', 'audit_log incident acknowledgements'],
      phase: 4
    },
    {
      id: 'sigma-restoration',
      vendorId: 'sigma',
      contractId: 'sigma-2024',
      category: 'restoration',
      title: 'Service restoration',
      appliesTo: { business: ['fixed', 'mobile'], domains: ['OSS', 'ITSM', 'DMS', 'Infrastructure'] },
      target: { P1: '2 hours', P2: '4 hours', P3: '8 hours', P4: '1 day' },
      attainmentTarget: '99%',
      weight: '5%',
      operatorMessages: {
        met: 'Sigma restoration is within SLA.',
        warning: 'Sigma restoration is approaching SLA; confirm workaround/ETA.',
        breached: 'Sigma restoration SLA breached; request RCA and management escalation.'
      },
      evidencePlan: ['alerts.resolved_at - alerts.fired_at', 'incident restore time', 'change/problem tickets'],
      phase: 4
    },
    {
      id: 'sigma-resolution-non-bug',
      vendorId: 'sigma',
      contractId: 'sigma-2024',
      category: 'resolution',
      title: 'Resolution for non-bug / managed service issues',
      appliesTo: { business: ['fixed', 'mobile'], domains: ['OSS', 'ITSM', 'DMS', 'Infrastructure'] },
      target: { P1: '2 hours', P2: '4 hours', P3: '1 day', P4: '2 days' },
      attainmentTarget: '99%',
      weight: '1%',
      operatorMessages: {
        met: 'Resolution is within Sigma SLA.',
        warning: 'Resolution is near Sigma SLA; ensure owner and ETA are visible.',
        breached: 'Resolution SLA breached; confirm exception, RCA, and vendor accountability.'
      },
      evidencePlan: ['incident closed_at - incident opened_at', 'problem ticket closure', 'vendor escalation notes'],
      phase: 4
    },
    {
      id: 'sigma-resolution-product-bug',
      vendorId: 'sigma',
      contractId: 'sigma-2024',
      category: 'product_bug_resolution',
      title: 'Product bug / vendor resolution',
      appliesTo: { business: ['fixed', 'mobile'], domains: ['OSS', 'ITSM', 'DMS', 'Infrastructure'] },
      target: { P1: '1 day', P2: '3 days', P3: '7 days', P4: '12 days' },
      attainmentTarget: '99%',
      weight: '1%',
      operatorMessages: {
        met: 'Product bug resolution is within Sigma target.',
        warning: 'Product bug resolution is close to SLA; confirm vendor ticket and workaround.',
        breached: 'Product bug resolution breached; escalate vendor ticket and business impact.'
      },
      evidencePlan: ['vendor ticket opened/closed', 'problem ticket linked to incident', 'release/change deployment evidence'],
      phase: 4
    },
    {
      id: 'sigma-availability',
      vendorId: 'sigma',
      contractId: 'sigma-2024',
      category: 'availability',
      title: 'Mission-critical availability',
      appliesTo: { business: ['fixed', 'mobile'], domains: ['OSS', 'DMS', 'Infrastructure'] },
      target: { availability: '99.99%', ORPO: '<10 min', ORTO: '<30 min' },
      attainmentTarget: '99.99%',
      weight: 'availability SLA',
      operatorMessages: {
        met: 'Availability is within Sigma target.',
        warning: 'Availability is close to monthly error budget.',
        breached: 'Availability breached; prepare outage window, approved exclusions, and RCA package.'
      },
      evidencePlan: ['probe uptime', 'alerts outage duration', 'maintenance windows', 'approved exclusions'],
      phase: 4
    },
    {
      id: 'tcs-response',
      vendorId: 'tcs',
      contractId: 'tcs-2026-mvno-itops',
      category: 'incident_response',
      title: 'Incident response',
      appliesTo: { business: ['mobile'], domains: ['Digital', 'BSS', 'OSS', 'ITSM', 'API Gateway'] },
      target: { P1: '<15 min', P2: '<30 min', P3: '<2 hours', P4: '<1 business day' },
      attainmentTarget: '95%',
      weight: { P1: '3%', P2: '2%', P3: '1%', P4: '1%' },
      operatorMessages: {
        met: 'TCS response is within SLA.',
        warning: 'TCS response is close to SLA; verify ticket ownership.',
        breached: 'TCS response SLA breached; escalate to service delivery and check exclusions.'
      },
      evidencePlan: ['alerts.ack_at - alerts.fired_at', 'ITSM ticket response timestamp', 'on-call audit trail'],
      phase: 4
    },
    {
      id: 'tcs-restoration',
      vendorId: 'tcs',
      contractId: 'tcs-2026-mvno-itops',
      category: 'restoration',
      title: 'Incident restoration',
      appliesTo: { business: ['mobile'], domains: ['Digital', 'BSS', 'OSS', 'ITSM', 'API Gateway'] },
      target: { P1: '<4 hours', P2: '<8 hours', P3: '<3 business days', P4: '<5 business days' },
      attainmentTarget: '95%',
      weight: { P1: '7%', P2: '5%', P3: '2%', P4: '1%' },
      operatorMessages: {
        met: 'TCS restoration is within SLA.',
        warning: 'TCS restoration is approaching SLA; confirm workaround and ETA.',
        breached: 'TCS restoration SLA breached; escalate and request RCA/action plan.'
      },
      evidencePlan: ['alert duration', 'incident restore timestamp', 'service recovery notes'],
      phase: 4
    },
    {
      id: 'tcs-rca',
      vendorId: 'tcs',
      contractId: 'tcs-2026-mvno-itops',
      category: 'rca',
      title: 'RCA for P1/P2 incidents',
      appliesTo: { business: ['mobile'], domains: ['Digital', 'BSS', 'OSS', 'ITSM', 'API Gateway'] },
      target: { P1: '<48 hours', P2: '<48 hours' },
      attainmentTarget: '95%',
      weight: '1% measure/report only',
      operatorMessages: {
        met: 'RCA is within target.',
        warning: 'RCA is due soon; confirm owner and report ETA.',
        breached: 'RCA is overdue; flag in governance pack and service review.'
      },
      evidencePlan: ['incident closed_at to RCA submitted_at', 'problem/RCA document reference'],
      phase: 4
    },
    {
      id: 'tcs-availability',
      vendorId: 'tcs',
      contractId: 'tcs-2026-mvno-itops',
      category: 'availability',
      title: 'Application / integration availability',
      appliesTo: { business: ['mobile'], domains: ['Digital', 'BSS', 'API Gateway', 'Payments', 'MNP'] },
      target: {
        DMS: '99.9%',
        'Digital Apps': '99.9%',
        'Web Portal': '99.9%',
        'Kong API Gateway': '99.9%',
        'NetAxis MNP': '99.9%',
        'Backups/restore': '99.9%'
      },
      attainmentTarget: '99.9%',
      weight: '1%-3% by system',
      operatorMessages: {
        met: 'Availability is within TCS target.',
        warning: 'Availability is close to the monthly budget; watch incident duration.',
        breached: 'Availability breached; confirm planned downtime exclusions and vendor ownership.'
      },
      evidencePlan: ['synthetic probes', 'API gateway availability', 'incident downtime', 'maintenance calendar'],
      phase: 4
    },
    {
      id: 'tcs-performance-orders',
      vendorId: 'tcs',
      contractId: 'tcs-2026-mvno-itops',
      category: 'performance',
      title: 'Order processing and integration performance',
      appliesTo: { business: ['mobile'], domains: ['Digital', 'BSS', 'Payments', 'MNP'] },
      target: {
        'Orders within 4 hours': '99%',
        'ZATCA reconciliation': 'within 3 working days',
        'Semati cancel notification': '97%',
        'New SIM Digital/DMS to BSS': '97% within 20s; 99% within 60s',
        'SIM swap DMS to BSS': '98% within 20s'
      },
      attainmentTarget: 'varies by metric',
      weight: 'performance SLA',
      operatorMessages: {
        met: 'Operational performance is within target.',
        warning: 'Performance is near target; inspect queue/backlog and integration latency.',
        breached: 'Performance breached; isolate Digital, APIGW, OSB/BSS, or third-party delay.'
      },
      evidencePlan: ['rollup_hourly journey timings', 'APIGW traces', 'OSB archive', 'BSS order state timestamps', 'payment callbacks'],
      phase: 4
    },
    {
      id: 'tcs-governance',
      vendorId: 'tcs',
      contractId: 'tcs-2026-mvno-itops',
      category: 'governance',
      title: 'Resource, KT, backup, security and change governance',
      appliesTo: { business: ['mobile'], domains: ['ITSM', 'Digital', 'BSS', 'OSS'] },
      target: {
        'Resource availability': '100%',
        'Required skills': '100%',
        'Resource numbers': '100%',
        'Backup success': '99%',
        'Security patching': 'per agreed plan',
        'Change failed deployments': 'tracked in governance'
      },
      attainmentTarget: 'varies by KPI',
      weight: 'governance KPI',
      operatorMessages: {
        met: 'Governance KPI is within target.',
        warning: 'Governance KPI needs attention before service review.',
        breached: 'Governance KPI breached; record action owner and service-credit impact if applicable.'
      },
      evidencePlan: ['resource roster', 'KT sign-off', 'backup job result', 'change calendar', 'failed deployment incidents'],
      phase: 5
    }
  ],
  assignments: [
    {
      id: 'mvno-digital-tcs',
      vendorId: 'tcs',
      business: 'mobile',
      domains: ['Digital', 'BSS', 'API Gateway', 'Payments', 'MNP'],
      journeys: ['new SIM', 'MNP', 'recharge/payment', 'change plan', 'SIM swap'],
      consoleSurfaces: ['Mobile dashboard', 'Monitoring/APIGW', 'Subscriber 360', 'Yusr', 'SLA page']
    },
    {
      id: 'fixed-mobile-ops-sigma',
      vendorId: 'sigma',
      business: 'both',
      domains: ['OSS', 'ITSM', 'DMS', 'Infrastructure', 'Remedy'],
      journeys: ['incident handling', 'OSS/DMS operations', 'fixed/mobile operational support'],
      consoleSurfaces: ['Fixed dashboard', 'Mobile dashboard', 'Alerts', 'SLA page', 'monthly governance pack']
    }
  ],
  escalationFlows: [
    {
      id: 'sigma-2024-escalation',
      vendorId: 'sigma',
      contractId: 'sigma-2024',
      title: 'Sigma contract SLA escalation',
      enabled: true,
      mode: 'reference',
      ownerGroup: 'Sigma managed services',
      description: 'Reference reminder and escalation ladder per contractual SLA item. It mirrors the ACK SLA pattern, but is evaluated per contract once evidence connectors are approved.',
      channels: { mail: true, teams: false, whatsapp: false, managementMail: true },
      managementRecipients: [],
      defaultPolicy: clone(SIGMA_ESCALATION_POLICY),
      items: [
        escalationItem('sigma-response', SIGMA_ESCALATION_POLICY, 'Response SLA at risk or breached; verify priority, clock-stop reason, ACK trail and vendor owner.'),
        escalationItem('sigma-restoration', SIGMA_ESCALATION_POLICY, 'Restoration SLA at risk or breached; confirm workaround, ETA, outage evidence and management escalation.'),
        escalationItem('sigma-resolution-non-bug', SIGMA_ESCALATION_POLICY, 'Resolution SLA at risk or breached; confirm issue owner, closure evidence and approved exclusion if any.'),
        escalationItem('sigma-resolution-product-bug', SIGMA_ESCALATION_POLICY, 'Product-bug SLA at risk or breached; confirm vendor ticket, workaround and release/change plan.'),
        escalationItem('sigma-availability', SIGMA_ESCALATION_POLICY, 'Availability budget at risk or breached; prepare downtime evidence, maintenance exclusions and RCA package.')
      ]
    },
    {
      id: 'tcs-2026-mvno-itops-escalation',
      vendorId: 'tcs',
      contractId: 'tcs-2026-mvno-itops',
      title: 'TCS MVNO IT operations escalation',
      enabled: true,
      mode: 'reference',
      ownerGroup: 'TCS service delivery',
      description: 'Reference reminder and escalation ladder for Digital/BSS/OSS/ITSM SLA obligations under the MVNO managed-services contract.',
      channels: { mail: true, teams: false, whatsapp: false, managementMail: true },
      managementRecipients: [],
      defaultPolicy: clone(TCS_ESCALATION_POLICY),
      items: [
        escalationItem('tcs-response', TCS_ESCALATION_POLICY, 'Response SLA at risk or breached; escalate to service delivery and verify on-call ownership.'),
        escalationItem('tcs-restoration', TCS_ESCALATION_POLICY, 'Restoration SLA at risk or breached; request workaround, ETA and recovery owner.'),
        escalationItem('tcs-rca', TCS_ESCALATION_POLICY, 'RCA SLA at risk or overdue; chase RCA owner and add governance follow-up.'),
        escalationItem('tcs-availability', TCS_ESCALATION_POLICY, 'Availability target at risk or breached; validate downtime source, planned exclusions and service impact.'),
        escalationItem('tcs-performance-orders', TCS_ESCALATION_POLICY, 'Performance SLA at risk or breached; isolate Digital, APIGW, OSB/BSS, payment or third-party delay.'),
        escalationItem('tcs-governance', TCS_ESCALATION_POLICY, 'Governance KPI needs attention; request roster, backup, security or change evidence before review.')
      ]
    }
  ],
  evidenceSources: [
    { key: 'ack_sla', label: 'ACK SLA', status: 'live', use: 'response time evidence from alert fired/ack timestamps', readOnly: true, owner: 'Operations Console', confidence: 'exact for console alerts' },
    { key: 'alerts', label: 'Alerts / incidents', status: 'live', use: 'incident opening, owner, severity and resolve timestamps', readOnly: true, owner: 'Operations Console', confidence: 'exact for console incidents' },
    { key: 'rollups', label: 'Journey rollups', status: 'live', use: 'success, failure and latency SLOs for current dashboards', readOnly: true, owner: 'Operations Console', confidence: 'exact for measured journeys' },
    { key: 'apigw', label: 'APIGW traces', status: 'partial', use: 'Digital/API latency and error detail where trace retention exists', readOnly: true, owner: 'Digital/API Gateway', confidence: 'exact when request id exists; window-based otherwise' },
    { key: 'osb_archive', label: 'OSB archive', status: 'partial', use: 'BSS/OSB backend story with ECID join when present', readOnly: true, owner: 'BSS/OSB archive', confidence: 'exact by ECID; probable by subscriber+time' },
    { key: 'itsm', label: 'Remedy / ITSM', status: 'planned', use: 'contractual ticket response/restoration/resolution evidence', readOnly: true, owner: 'ITSM owner', confidence: 'pending connector' },
    { key: 'vendor_reports', label: 'Monthly vendor reports', status: 'planned', use: 'governance, resource, KT, penalties and exclusions', readOnly: true, owner: 'Vendor governance', confidence: 'manual until report import is wired' }
  ],
  evidenceMappings: [
    evidenceMap('ev-sigma-response', 'sigma-response', ['ack_sla', 'alerts', 'itsm'], 'ack_sla', 'acknowledgement_minutes', 'alerts.ack_at - alerts.fired_at, cross-checked with Remedy/ITSM once connected', 'Alerts / ACK SLA / SLA dashboard', 'live', 'high', 'Clock-stop and priority changes must be documented before SLA breach is final.', 'Wire Remedy incident id to each console alert.'),
    evidenceMap('ev-sigma-restoration', 'sigma-restoration', ['alerts', 'itsm'], 'alerts', 'restoration_minutes', 'alerts.resolved_at - alerts.fired_at, later replaced/validated by ITSM restore timestamp', 'Alerts / SLA dashboard / monthly governance', 'live_partial', 'medium-high', 'Console resolution is operational evidence; final contractual restoration needs ITSM validation.', 'Add ITSM restore timestamp import.'),
    evidenceMap('ev-sigma-resolution-non-bug', 'sigma-resolution-non-bug', ['itsm', 'vendor_reports'], 'itsm', 'resolution_duration', 'incident closed_at - incident opened_at, excluding approved waiting/clock-stop windows', 'Monthly governance pack', 'planned', 'pending', 'Do not score until ITSM close reasons and exclusions are imported.', 'Map Remedy status/closure fields.'),
    evidenceMap('ev-sigma-resolution-product-bug', 'sigma-resolution-product-bug', ['itsm', 'vendor_reports'], 'itsm', 'vendor_bug_resolution_duration', 'vendor ticket closed_at - opened_at, linked to problem/change evidence', 'Monthly governance pack', 'planned', 'pending', 'Use as informational only until vendor ticket references are consistently captured.', 'Define vendor ticket reference field and change link.'),
    evidenceMap('ev-sigma-availability', 'sigma-availability', ['alerts', 'vendor_reports'], 'alerts', 'availability_error_budget', 'incident outage duration and probes compared with monthly availability target', 'SLA dashboard / monthly governance', 'partial', 'medium', 'Exclude planned maintenance and approved customer/client dependency windows.', 'Connect approved maintenance calendar.'),
    evidenceMap('ev-tcs-response', 'tcs-response', ['ack_sla', 'alerts', 'itsm'], 'ack_sla', 'acknowledgement_minutes', 'alerts.ack_at - alerts.fired_at, cross-checked with ITSM response timestamp', 'Alerts / ACK SLA / SLA dashboard', 'live', 'high', 'No vendor breach unless ownership and severity are confirmed.', 'Map ITSM ticket response timestamp.'),
    evidenceMap('ev-tcs-restoration', 'tcs-restoration', ['alerts', 'itsm'], 'alerts', 'restoration_minutes', 'alerts.resolved_at - alerts.fired_at, validated by ITSM/service recovery notes', 'Alerts / SLA dashboard / monthly governance', 'live_partial', 'medium-high', 'Treat console resolution as operational evidence until ITSM restore field is connected.', 'Connect ITSM restore and workaround timestamps.'),
    evidenceMap('ev-tcs-rca', 'tcs-rca', ['itsm', 'vendor_reports'], 'itsm', 'rca_submission_hours', 'RCA submitted_at - incident closed_at for P1/P2 incidents', 'Monthly governance pack', 'planned', 'pending', 'Measure/report only until RCA document reference is imported.', 'Add RCA document/date fields to governance upload.'),
    evidenceMap('ev-tcs-availability', 'tcs-availability', ['apigw', 'alerts', 'vendor_reports'], 'apigw', 'service_availability', 'probe/API availability plus incident downtime compared with monthly target', 'Monitoring / SLA dashboard / governance pack', 'partial', 'medium', 'APIGW and alert evidence are informative until service inventory and planned downtime are joined.', 'Map system ownership and planned downtime exclusions.'),
    evidenceMap('ev-tcs-performance-orders', 'tcs-performance-orders', ['rollups', 'apigw', 'osb_archive'], 'rollups', 'journey_success_latency', 'journey rollup success/latency with APIGW and OSB support evidence where correlation exists', 'Mobile dashboard / Monitoring / Customer 360 / Yusr', 'partial', 'medium', 'Digital->APIGW->OSB exact trace is exact only with shared trace id/ECID; otherwise show confidence as probable.', 'Add shared trace id capture where available.'),
    evidenceMap('ev-tcs-governance', 'tcs-governance', ['vendor_reports', 'itsm'], 'vendor_reports', 'governance_kpi_attainment', 'monthly vendor report metrics and linked ITSM/change evidence', 'Monthly governance pack', 'planned', 'pending', 'No automated breach until the report template and owner sign-off are defined.', 'Create monthly report import template.')
  ],
  rolloutSurfaces: [
    rolloutSurface('rollout-sla-dashboard', 'SLA dashboard vendor health', ['sigma', 'tcs'], ['fixed', 'mobile'], 'L2 leads, vendor owners, management', ['#sla'], 'informational badges', 'ready', 'Vendor SLA status, evidence confidence, breach messages, and disabled enforcement gate.', ['ack_sla', 'alerts', 'rollups', 'apigw', 'osb_archive'], 'UAT confirms wording and evidence confidence before any red/paging behavior is enabled.', 'Read-only; no penalty calculation.'),
    rolloutSurface('rollout-yusr', 'Yusr support answer context', ['sigma', 'tcs'], ['fixed', 'mobile'], 'Call center, L1, L2', ['Yusr chatbot'], 'context only', 'ready', 'Plain-language vendor/SLA reason, evidence status, and next support action without raw sensitive payloads.', ['rollups', 'apigw', 'osb_archive', 'alerts'], 'Prompt output must label exact vs probable correlation and avoid contractual breach claims.', 'No autonomous vendor escalation.'),
    rolloutSurface('rollout-incident-details', 'Incident details and escalation trail', ['sigma', 'tcs'], ['fixed', 'mobile'], 'L1/L2 incident owners', ['#alerts', '#fixed-alerts', 'incident drawer'], 'pilot informational', 'ready', 'Mapped contract SLA item, current clock, owner group, R1/R2/R3 policy, breach message, and evidence links.', ['ack_sla', 'alerts', 'itsm'], 'Incident owners validate that the mapped SLA item and severity are correct.', 'Existing ACK SLA remains the live reminder engine.'),
    rolloutSurface('rollout-customer360', 'Customer 360 / Subscriber story', ['tcs'], ['mobile'], 'Call center and L2 customer support', ['#subscriber', 'Customer 360'], 'context only', 'ready', 'For selected customer/MSISDN: related BSS/OSB/APIGW evidence, journey stage, vendor-domain hint, and confidence.', ['rollups', 'apigw', 'osb_archive'], 'Show only support-safe summaries; hide raw payload unless the existing PII/unmask controls allow it.', 'No contractual scoring from customer view.'),
    rolloutSurface('rollout-monitoring', 'Monitoring drill-downs', ['tcs'], ['mobile'], 'Digital Ops, BSS, L2', ['#monitoring'], 'diagnostic', 'ready', 'OSB/APIGW/rollup evidence grouped by business story and linked to affected SLA items.', ['apigw', 'osb_archive', 'rollups'], 'Operators confirm source coverage gaps and day-lag constraints.', 'Correlation confidence shown on every row.'),
    rolloutSurface('rollout-monthly-pack', 'Monthly governance pack', ['sigma', 'tcs'], ['fixed', 'mobile'], 'Management, vendor governance, commercial/legal', ['monthly report export'], 'manual governance', 'planned', 'Vendor SLA attainment, exclusions, RCA follow-up, penalties/credits candidate list, and evidence appendix.', ['itsm', 'vendor_reports', 'alerts'], 'Requires report template, owner sign-off, and legal/commercial review before formal use.', 'No automatic penalty workflow.'),
    rolloutSurface('rollout-mail-preview', 'Mail/reminder format preview', ['sigma', 'tcs'], ['fixed', 'mobile'], 'Super Admin, vendor governance owner', ['CLI test mail'], 'test only', 'ready', 'R1/R2/R3/repeat/management mail formats can be sent only to the typed test recipient.', ['vendor_contracts'], 'Use CLI preview before enabling any real recipient path.', 'Test command ignores configured recipients.')
  ],
  penaltyGovernance: {
    currency: 'SAR',
    mode: 'estimate_only',
    formula: 'candidate_penalty = eligible_monthly_fee * applicable_weight_percent * breach_factor; monthly_total = min(sum(candidate_penalties), eligible_monthly_fee * contract_cap_percent)',
    controls: [
      'Penalty output is a candidate estimate only until commercial/legal approval.',
      'Every candidate needs an evidence link, SLA owner validation, vendor owner validation, and exclusion review.',
      'Planned/partial evidence sources can inform the candidate but cannot approve a penalty alone.',
      'Final penalty uses the signed contract, the eligible monthly invoice base, approved exclusions, and monthly cap.'
    ],
    defaultBreachFactor: 1,
    defaultApprovalStatus: 'commercial_validation_required'
  },
  penaltyRules: [
    penaltyRule('pen-sigma-response', 'sigma', 'sigma-2024', 'sigma-response', { weightPercent: 1, notes: 'Sigma response weight is seeded from the SLA item; confirm penalty conversion and cap from signed clause 12 / penalty schedule before enforcement.' }),
    penaltyRule('pen-sigma-restoration', 'sigma', 'sigma-2024', 'sigma-restoration', { weightPercent: 5, notes: 'Sigma restoration weight is seeded from the SLA item; confirm invoice base, cap and approved outage exclusions before enforcement.' }),
    penaltyRule('pen-sigma-resolution-non-bug', 'sigma', 'sigma-2024', 'sigma-resolution-non-bug', { weightPercent: 1, notes: 'Estimate only until Remedy/ITSM closure and approved clock-stop windows are imported.' }),
    penaltyRule('pen-sigma-resolution-product-bug', 'sigma', 'sigma-2024', 'sigma-resolution-product-bug', { weightPercent: 1, notes: 'Estimate only until vendor ticket lifecycle and release/change evidence are consistently linked.' }),
    penaltyRule('pen-sigma-availability', 'sigma', 'sigma-2024', 'sigma-availability', { calculationMethod: 'eligible_fee_x_availability_weight_x_chargeable_downtime_factor', weightPercent: null, notes: 'Availability penalty needs the signed availability weighting/tiering table and approved maintenance calendar.' }),
    penaltyRule('pen-tcs-response', 'tcs', 'tcs-2026-mvno-itops', 'tcs-response', { monthlyCapPercent: 5, severityWeights: { P1: 3, P2: 2, P3: 1, P4: 1 }, capBasis: 'Proposal/reference cap: 5% monthly invoice cap; confirm final contract before enforcement.', notes: 'Response penalty is severity-weighted in the proposal reference; keep candidate-only until final commercial sign-off.' }),
    penaltyRule('pen-tcs-restoration', 'tcs', 'tcs-2026-mvno-itops', 'tcs-restoration', { monthlyCapPercent: 5, severityWeights: { P1: 7, P2: 5, P3: 2, P4: 1 }, capBasis: 'Proposal/reference cap: 5% monthly invoice cap; confirm final contract before enforcement.', notes: 'Restoration penalty needs verified incident restoration timestamps and exclusion review.' }),
    penaltyRule('pen-tcs-rca', 'tcs', 'tcs-2026-mvno-itops', 'tcs-rca', { monthlyCapPercent: 5, weightPercent: 1, calculationMethod: 'measure_report_candidate_only', notes: 'RCA is measure/report only in the current reference; do not convert to penalty until governance confirms.' }),
    penaltyRule('pen-tcs-availability', 'tcs', 'tcs-2026-mvno-itops', 'tcs-availability', { monthlyCapPercent: 5, weightPercent: null, calculationMethod: 'eligible_fee_x_system_availability_weight_x_chargeable_downtime_factor', notes: 'Availability weight varies by system in the reference; requires system ownership, outage windows and planned exclusions.' }),
    penaltyRule('pen-tcs-performance-orders', 'tcs', 'tcs-2026-mvno-itops', 'tcs-performance-orders', { monthlyCapPercent: 5, weightPercent: null, calculationMethod: 'performance_sla_tiering_required', notes: 'Performance penalties need metric-specific tiering and exact Digital/APIGW/OSB/BSS evidence confidence before scoring.' }),
    penaltyRule('pen-tcs-governance', 'tcs', 'tcs-2026-mvno-itops', 'tcs-governance', { monthlyCapPercent: 5, weightPercent: null, calculationMethod: 'governance_report_candidate_only', notes: 'Governance KPIs are tracked for service review until monthly vendor-report import and penalty eligibility are approved.' })
  ],
  penaltyCandidateExamples: [
    {
      id: 'example-single-weight',
      title: 'Single SLA item breach',
      formula: 'eligible monthly fee * SLA weight % * breach factor',
      example: '1,000,000 SAR * 3% * 1.0 = 30,000 SAR candidate penalty'
    },
    {
      id: 'example-monthly-cap',
      title: 'Monthly cap',
      formula: 'min(sum of validated candidates, eligible monthly fee * cap %)',
      example: 'If cap is 5% and eligible fee is 1,000,000 SAR, monthly maximum is 50,000 SAR'
    }
  ],
  deploymentPlan: [
    'Deploy code with the new vendor-contracts page and API only; no database migration is required.',
    'Load https://salam.sa/unified-console/#vendor-contracts as a Super Admin.',
    'Review Sigma/TCS reference data, escalation flows, evidence mappings and penalty model inputs.',
    'Enter eligible monthly fee/cap only after commercial validation; leave blank to keep penalty exposure hidden.',
    'Do not enable penalty/enforcement workflows until evidence connectors are validated in phase 4.'
  ],
  testScenarios: [
    {
      id: 'access-super-admin',
      title: 'Super Admin can open the page',
      steps: ['Sign in as Super Admin.', 'Open Settings -> Vendors & contracts.', 'Confirm URL is #vendor-contracts and summary cards render.'],
      expected: 'Sigma and TCS appear with phase timeline, obligations, contract-level escalation flows, assignments, and evidence sources.'
    },
    {
      id: 'access-non-super',
      title: 'Non-super users cannot access the page',
      steps: ['Preview or sign in as a non-super role.', 'Navigate directly to #vendor-contracts.', 'Call /api/vendor-contracts from the browser dev tools if needed.'],
      expected: 'UI shows access denied or redirects, and API returns 403 super admin only.'
    },
    {
      id: 'save-edit',
      title: 'Reference edits persist safely',
      steps: ['Open Vendors & contracts.', 'Open Escalation flow.', 'Change a reminder timing, channel, or management recipient.', 'Click Save changes.', 'Refresh the page.'],
      expected: 'Saved values remain; audit log records vendor-contracts.update; no existing ACK SLA or dashboard SLO values change.'
    },
    {
      id: 'phase4-evidence-matrix',
      title: 'Phase 4 evidence matrix is clear',
      steps: ['Open Vendors & contracts.', 'Select Sigma and then TCS.', 'Open Evidence connectors.', 'Review each SLA item row.'],
      expected: 'Every obligation shows primary metric, source connectors, readiness, confidence, controls and next connector step.'
    },
    {
      id: 'phase5-rollout-plan',
      title: 'Phase 5 rollout is informational',
      steps: ['Open Vendors & contracts.', 'Open Operational rollout.', 'Check SLA dashboard, Yusr, incident details, Customer 360, monitoring, governance pack and mail preview rows.'],
      expected: 'Each surface states audience, what will be shown, evidence source, gate, and a control that keeps enforcement disabled until sign-off.'
    },
    {
      id: 'penalty-model-candidate-only',
      title: 'Penalty model remains candidate-only',
      steps: ['Open Vendors & contracts.', 'Open Penalty model.', 'Enter a temporary eligible monthly fee.', 'Confirm estimated exposure updates, then Save changes and refresh.'],
      expected: 'Fee/cap/rule weights persist, estimated penalty exposure is visible, and every rule stays marked estimate-only / commercial validation required.'
    },
    {
      id: 'reset-defaults',
      title: 'Defaults can be restored',
      steps: ['Click Reset defaults.', 'Confirm the action.', 'Refresh the page.'],
      expected: 'Sigma/TCS defaults and five phases return; audit log records vendor-contracts.reset.'
    },
    {
      id: 'regression-slo-ack',
      title: 'Existing ACK/SLO surfaces are unchanged',
      steps: ['Open #sla and #slo-settings.', 'Open Settings -> Notifications & escalation.', 'Check /api/slo/config and /api/ack-sla.'],
      expected: 'Current SLO definitions and ACK SLA configs load normally; no target value changes unless edited on their own pages.'
    }
  ],
  rollbackPlan: [
    'Preferred rollback: redeploy the previous release/tag so the new static JS and API routes disappear together.',
    'Config-only rollback: POST /api/vendor-contracts/reset as Super Admin to restore seeded reference data, escalation flows and candidate-only penalty defaults.',
    'Emergency UI hide: remove the menu item and view/script from index.html, then deploy with --web-only if server code is unchanged.',
    'Emergency full rollback: restore previous server/src/api.js plus remove server/src/vendorContracts.js and vendor-contracts.js, then run full deploy so PM2 restarts.',
    'Validation after rollback: #sla, #slo-settings, #home, #fixed, /api/slo/config, /api/vendors and /api/ack-sla/status must still return as before.'
  ]
};

function normalizeVendor(v, base = {}) {
  return {
    ...base,
    ...v,
    id: text(v.id || base.id, 80),
    name: text(v.name || base.name, 160),
    legalName: text(v.legalName || base.legalName, 180),
    type: text(v.type || base.type, 160),
    businessScope: arr(v.businessScope || base.businessScope).map(x => text(x, 40)).filter(Boolean),
    domains: arr(v.domains || base.domains).map(x => text(x, 60)).filter(Boolean),
    supportWindow: text(v.supportWindow || base.supportWindow, 500),
    contractStatus: text(v.contractStatus || base.contractStatus, 80),
    contacts: arr(v.contacts || base.contacts).map(c => ({
      name: text(c.name, 120),
      role: text(c.role, 120),
      email: text(c.email, 160),
      phone: text(c.phone, 80),
      level: text(c.level, 40)
    })),
    escalation: arr(v.escalation || base.escalation).map(x => text(x, 500)).filter(Boolean),
    notes: text(v.notes || base.notes, 1200)
  };
}

function normalizeContract(c, base = {}) {
  return {
    ...base,
    ...c,
    id: text(c.id || base.id, 100),
    vendorId: text(c.vendorId || base.vendorId, 80),
    title: text(c.title || base.title, 220),
    businessScope: arr(c.businessScope || base.businessScope).map(x => text(x, 40)).filter(Boolean),
    domains: arr(c.domains || base.domains).map(x => text(x, 80)).filter(Boolean),
    sourceDoc: text(c.sourceDoc || base.sourceDoc, 260),
    sourcePages: text(c.sourcePages || base.sourcePages, 260),
    effectiveFrom: text(c.effectiveFrom || base.effectiveFrom, 80),
    effectiveTo: c.effectiveTo == null ? base.effectiveTo || null : text(c.effectiveTo, 80),
    status: text(c.status || base.status, 100),
    eligibleMonthlyFeeSar: c.eligibleMonthlyFeeSar == null || c.eligibleMonthlyFeeSar === '' ? (base.eligibleMonthlyFeeSar == null ? null : num(base.eligibleMonthlyFeeSar, 0)) : num(c.eligibleMonthlyFeeSar, 0),
    monthlyPenaltyCapPercent: c.monthlyPenaltyCapPercent == null || c.monthlyPenaltyCapPercent === '' ? (base.monthlyPenaltyCapPercent == null ? null : Number(base.monthlyPenaltyCapPercent)) : Number(c.monthlyPenaltyCapPercent),
    penaltyMode: text(c.penaltyMode || base.penaltyMode || 'estimate_only', 80),
    penaltyCap: text(c.penaltyCap || base.penaltyCap, 800)
  };
}

function byId(list) {
  return Object.fromEntries(arr(list).filter(x => x && (x.id || x.key || x.obligationId)).map(x => [x.id || x.key || x.obligationId, x]));
}

function mergeDefaults(defaultList, rawList, normalizer) {
  const overrides = byId(rawList);
  const out = arr(defaultList).map(item => normalizer({ ...item, ...(overrides[item.id] || overrides[item.key] || {}) }, item));
  for (const item of arr(rawList)) {
    const id = item && (item.id || item.key);
    if (id && !out.some(x => (x.id || x.key) === id)) out.push(normalizer(item, {}));
  }
  return out;
}

function num(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fb;
}

function normalizePhase(p, base = {}) {
  return {
    ...base,
    ...p,
    id: text(p.id || base.id, 80),
    title: text(p.title || base.title, 140),
    status: text(p.status || base.status || 'next', 40),
    outcome: text(p.outcome || base.outcome, 900),
    riskControl: text(p.riskControl || base.riskControl, 900)
  };
}

function normalizeEvidenceSource(src, base = {}) {
  return {
    ...base,
    ...src,
    key: text(src.key || base.key, 80),
    label: text(src.label || base.label, 160),
    status: text(src.status || base.status || 'planned', 40),
    use: text(src.use || base.use, 700),
    readOnly: src.readOnly == null ? base.readOnly !== false : !!src.readOnly,
    owner: text(src.owner || base.owner, 160),
    confidence: text(src.confidence || base.confidence, 260)
  };
}

function normalizeEvidenceMapping(map, base = {}) {
  return {
    ...base,
    ...map,
    id: text(map.id || base.id, 120),
    obligationId: text(map.obligationId || base.obligationId, 120),
    sources: arr(map.sources || base.sources).map(x => text(x, 80)).filter(Boolean),
    primarySource: text(map.primarySource || base.primarySource, 80),
    metric: text(map.metric || base.metric, 160),
    calculation: text(map.calculation || base.calculation, 900),
    surface: text(map.surface || base.surface, 260),
    readiness: text(map.readiness || base.readiness || 'planned', 60),
    confidence: text(map.confidence || base.confidence || 'pending', 80),
    controls: text(map.controls || base.controls, 900),
    nextStep: text(map.nextStep || base.nextStep, 700)
  };
}

function normalizeRolloutSurface(surface, base = {}) {
  return {
    ...base,
    ...surface,
    id: text(surface.id || base.id, 120),
    title: text(surface.title || base.title, 180),
    vendors: arr(surface.vendors || base.vendors).map(x => text(x, 80)).filter(Boolean),
    businessScope: arr(surface.businessScope || base.businessScope).map(x => text(x, 40)).filter(Boolean),
    audience: text(surface.audience || base.audience, 240),
    surfaces: arr(surface.surfaces || base.surfaces).map(x => text(x, 120)).filter(Boolean),
    mode: text(surface.mode || base.mode, 80),
    status: text(surface.status || base.status, 80),
    shows: text(surface.shows || base.shows, 900),
    evidenceSources: arr(surface.evidenceSources || base.evidenceSources).map(x => text(x, 80)).filter(Boolean),
    gate: text(surface.gate || base.gate, 900),
    controls: text(surface.controls || base.controls, 900)
  };
}

function normalizePenaltyGovernance(pg, base = {}) {
  const raw = pg || {};
  return {
    ...base,
    ...raw,
    currency: text(raw.currency || base.currency || 'SAR', 12),
    mode: text(raw.mode || base.mode || 'estimate_only', 80),
    formula: text(raw.formula || base.formula, 1000),
    controls: arr(raw.controls || base.controls).map(x => text(x, 700)).filter(Boolean),
    defaultBreachFactor: Number(raw.defaultBreachFactor == null ? base.defaultBreachFactor || 1 : raw.defaultBreachFactor),
    defaultApprovalStatus: text(raw.defaultApprovalStatus || base.defaultApprovalStatus || 'commercial_validation_required', 120)
  };
}

function normalizePenaltyRule(rule, base = {}) {
  const raw = rule || {};
  const cap = raw.monthlyCapPercent == null || raw.monthlyCapPercent === '' ? base.monthlyCapPercent : raw.monthlyCapPercent;
  const weight = raw.weightPercent == null || raw.weightPercent === '' ? base.weightPercent : raw.weightPercent;
  return {
    ...base,
    ...raw,
    id: text(raw.id || base.id, 140),
    vendorId: text(raw.vendorId || base.vendorId, 80),
    contractId: text(raw.contractId || base.contractId, 120),
    obligationId: text(raw.obligationId || base.obligationId, 120),
    enabled: raw.enabled == null ? base.enabled !== false : !!raw.enabled,
    mode: text(raw.mode || base.mode || 'estimate_only', 80),
    calculationMethod: text(raw.calculationMethod || base.calculationMethod, 180),
    eligibleFeeBasis: text(raw.eligibleFeeBasis || base.eligibleFeeBasis, 700),
    monthlyCapPercent: cap == null || cap === '' ? null : Number(cap),
    capBasis: text(raw.capBasis || base.capBasis, 700),
    weightPercent: weight == null || weight === '' ? null : Number(weight),
    severityWeights: raw.severityWeights || base.severityWeights || null,
    breachFactor: text(raw.breachFactor || base.breachFactor, 500),
    statusFlow: arr(raw.statusFlow || base.statusFlow).map(x => text(x, 80)).filter(Boolean),
    evidenceRequired: arr(raw.evidenceRequired || base.evidenceRequired).map(x => text(x, 200)).filter(Boolean),
    exclusions: arr(raw.exclusions || base.exclusions).map(x => text(x, 220)).filter(Boolean),
    approvalRequired: arr(raw.approvalRequired || base.approvalRequired).map(x => text(x, 160)).filter(Boolean),
    approvalStatus: text(raw.approvalStatus || base.approvalStatus || 'commercial_validation_required', 120),
    notes: text(raw.notes || base.notes, 1000)
  };
}

function normalizePenaltyCandidateExample(example, base = {}) {
  return {
    ...base,
    ...example,
    id: text(example.id || base.id, 120),
    title: text(example.title || base.title, 200),
    formula: text(example.formula || base.formula, 500),
    example: text(example.example || base.example, 500)
  };
}

function normalizeSeverityPolicy(input, base = {}) {
  const raw = input || {};
  const out = {};
  for (const sev of ['P1', 'P2', 'P3', 'P4']) {
    const r = raw[sev] || {};
    const b = base[sev] || {};
    out[sev] = {
      reminder1Min: num(r.reminder1Min, num(b.reminder1Min, 0)),
      reminder2Min: num(r.reminder2Min, num(b.reminder2Min, 0)),
      reminder3Min: num(r.reminder3Min, num(b.reminder3Min, 0)),
      repeat3Min: num(r.repeat3Min, num(b.repeat3Min, 0)),
      informManagement: r.informManagement == null ? !!b.informManagement : !!r.informManagement
    };
  }
  return out;
}

function normalizeEscalationFlow(flow, base = {}) {
  const rawItems = arr(flow.items && flow.items.length ? flow.items : base.items);
  const baseItems = byId(base.items);
  const defaultPolicy = normalizeSeverityPolicy(flow.defaultPolicy || base.defaultPolicy, base.defaultPolicy);
  return {
    ...base,
    ...flow,
    id: text(flow.id || base.id, 100),
    vendorId: text(flow.vendorId || base.vendorId, 80),
    contractId: text(flow.contractId || base.contractId, 100),
    title: text(flow.title || base.title, 180),
    enabled: flow.enabled == null ? base.enabled !== false : !!flow.enabled,
    mode: text(flow.mode || base.mode || 'reference', 40),
    ownerGroup: text(flow.ownerGroup || base.ownerGroup, 160),
    description: text(flow.description || base.description, 600),
    channels: {
      mail: flow.channels && flow.channels.mail != null ? !!flow.channels.mail : !!(base.channels || {}).mail,
      teams: flow.channels && flow.channels.teams != null ? !!flow.channels.teams : !!(base.channels || {}).teams,
      whatsapp: flow.channels && flow.channels.whatsapp != null ? !!flow.channels.whatsapp : !!(base.channels || {}).whatsapp,
      managementMail: flow.channels && flow.channels.managementMail != null ? !!flow.channels.managementMail : !!(base.channels || {}).managementMail
    },
    managementRecipients: arr(flow.managementRecipients || base.managementRecipients).map(x => text(x, 180)).filter(Boolean),
    defaultPolicy,
    items: rawItems.map(item => {
      const b = baseItems[item.obligationId] || {};
      return {
        ...b,
        ...item,
        obligationId: text(item.obligationId || b.obligationId, 100),
        enabled: item.enabled == null ? b.enabled !== false : !!item.enabled,
        severityPolicy: normalizeSeverityPolicy(item.severityPolicy || b.severityPolicy || defaultPolicy, b.severityPolicy || defaultPolicy),
        ownerHint: text(item.ownerHint || b.ownerHint, 220),
        message: text(item.message || b.message, 600)
      };
    }).filter(x => x.obligationId)
  };
}

function normalizeConfig(input) {
  const raw = input || {};
  const defaults = clone(DEFAULT_CONFIG);
  const rawVersion = Number(raw.version || 0);
  const vendorOverrides = byId(raw.vendors);
  const vendors = defaults.vendors.map(v => normalizeVendor({ ...v, ...(vendorOverrides[v.id] || {}) }, v));
  for (const v of arr(raw.vendors)) {
    if (v && v.id && !vendors.some(x => x.id === v.id)) vendors.push(normalizeVendor(v));
  }
  const flowOverrides = byId(raw.escalationFlows);
  const escalationFlows = defaults.escalationFlows.map(f => normalizeEscalationFlow({ ...f, ...(flowOverrides[f.id] || {}) }, f));
  for (const f of arr(raw.escalationFlows)) {
    if (f && f.id && !escalationFlows.some(x => x.id === f.id)) escalationFlows.push(normalizeEscalationFlow(f));
  }
  const phases = rawVersion < 2
    ? defaults.phases.map(p => normalizePhase(p, p))
    : mergeDefaults(defaults.phases, raw.phases, normalizePhase);
  const out = {
    ...defaults,
    ...raw,
    version: 3,
    sourceNote: text(raw.sourceNote || defaults.sourceNote, 1200),
    phases,
    vendors,
    contracts: mergeDefaults(defaults.contracts, raw.contracts, normalizeContract),
    obligations: arr(raw.obligations && raw.obligations.length ? raw.obligations : defaults.obligations),
    assignments: arr(raw.assignments && raw.assignments.length ? raw.assignments : defaults.assignments),
    escalationFlows,
    evidenceSources: mergeDefaults(defaults.evidenceSources, raw.evidenceSources, normalizeEvidenceSource),
    evidenceMappings: mergeDefaults(defaults.evidenceMappings, raw.evidenceMappings, normalizeEvidenceMapping),
    rolloutSurfaces: mergeDefaults(defaults.rolloutSurfaces, raw.rolloutSurfaces, normalizeRolloutSurface),
    penaltyGovernance: normalizePenaltyGovernance(raw.penaltyGovernance, defaults.penaltyGovernance),
    penaltyRules: mergeDefaults(defaults.penaltyRules, raw.penaltyRules, normalizePenaltyRule),
    penaltyCandidateExamples: mergeDefaults(defaults.penaltyCandidateExamples, raw.penaltyCandidateExamples, normalizePenaltyCandidateExample),
    deploymentPlan: arr(raw.deploymentPlan && raw.deploymentPlan.length ? raw.deploymentPlan : defaults.deploymentPlan),
    testScenarios: arr(raw.testScenarios && raw.testScenarios.length ? raw.testScenarios : defaults.testScenarios),
    rollbackPlan: arr(raw.rollbackPlan && raw.rollbackPlan.length ? raw.rollbackPlan : defaults.rollbackPlan),
    updated_at: raw.updated_at || null
  };
  return out;
}

function summarize(cfg) {
  const obligations = arr(cfg.obligations);
  const byBusiness = {};
  const byDomain = {};
  for (const o of obligations) {
    const scope = (o.appliesTo || {});
    arr(scope.business).forEach(b => { byBusiness[b] = (byBusiness[b] || 0) + 1; });
    arr(scope.domains).forEach(d => { byDomain[d] = (byDomain[d] || 0) + 1; });
  }
  return {
    vendors: arr(cfg.vendors).length,
    contracts: arr(cfg.contracts).length,
    obligations: obligations.length,
    assignments: arr(cfg.assignments).length,
    escalationFlows: arr(cfg.escalationFlows).length,
    evidenceSources: arr(cfg.evidenceSources).length,
    evidenceMappings: arr(cfg.evidenceMappings).length,
    rolloutSurfaces: arr(cfg.rolloutSurfaces).length,
    penaltyRules: arr(cfg.penaltyRules).length,
    penaltyReadyContracts: arr(cfg.contracts).filter(c => c.eligibleMonthlyFeeSar != null && c.monthlyPenaltyCapPercent != null).length,
    liveEvidenceSources: arr(cfg.evidenceSources).filter(e => e.status === 'live').length,
    partialEvidenceSources: arr(cfg.evidenceSources).filter(e => e.status === 'partial').length,
    readyPhases: arr(cfg.phases).filter(p => p.status === 'ready').length,
    nextPhases: arr(cfg.phases).filter(p => p.status !== 'ready').length,
    byBusiness,
    byDomain
  };
}

async function getConfig() {
  const saved = await settings.getSetting(CONFIG_KEY);
  const cfg = normalizeConfig(saved || DEFAULT_CONFIG);
  return { ...cfg, summary: summarize(cfg), canEdit: true };
}

async function saveConfig(input) {
  const cfg = normalizeConfig(input || {});
  cfg.updated_at = isoNow();
  await settings.setSetting(CONFIG_KEY, cfg);
  return { ...cfg, summary: summarize(cfg), canEdit: true };
}

async function resetConfig() {
  const cfg = clone(DEFAULT_CONFIG);
  cfg.updated_at = isoNow();
  await settings.setSetting(CONFIG_KEY, cfg);
  return { ...cfg, summary: summarize(cfg), canEdit: true };
}

module.exports = { CONFIG_KEY, DEFAULT_CONFIG, normalizeConfig, summarize, getConfig, saveConfig, resetConfig };
