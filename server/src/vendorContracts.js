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
  version: 4,
  sourceNote: 'Reference data extracted from the SIGNED documents (24 Sep 2026 review): Sigma CONT-SALAM-167-2024 + addenda; TCS SALAM-CONT-206-2022 WP1 + Amendments 1-4 (Amendment 1 replaced the proposal SLA); Oracle, Subex, Comviva, Infosys and Evamp & Saanga from vendorContractsSeedExt.js. Financials are quoted from the contracts; eligible fees are proposals to validate with Finance before any formal penalty calculation.',
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
      contractStatus: 'signed — effective 27 Jun 2024; renewed in 6-month steps (latest to 30 Jun 2026 per RTP 37264, instrument not in file set); Fixed digital ops extended to 31 Aug 2026 (Fourth Addendum)',
      contacts: [],
      escalation: [
        'P1/P2: acknowledge immediately per response SLA and escalate to L2/L3/vendor where needed.',
        'Contract governance: Operational committee weekly, Management committee monthly, Executive committee quarterly (§6.2). No named escalation matrix in the contract — to be developed in transition (§5.1.2).',
        'Use approved clock-stop only for third-party, planned downtime, or customer/client dependency delays.'
      ],
      notes: 'Scope: ZSmart OSS, GIS (Esri), Remedy, DMS (NewGen), Big Data (Cloudera/Informatica/SingleStore/Tableau), applications infrastructure; added Vanrise Wholesale + HPE L2 (Dec 2024), Fixed Digital channels ops (Aug 2025, Fourth Addendum Mar 2026), SharePoint SE (Nov 2025). Serves Salam and TLS. L1 24x7 offshore, L2 Sun-Thu 8-17 + on-call, L3 = product vendors. Vendor-reported SLA attainment Jan-Jun 2025: 99.15-99.79% (aggregate only, no per-KPI split, no credit claimed).'
    },
    {
      id: 'tcs',
      name: 'TCS',
      legalName: 'Tata Consultancy Services',
      type: 'MVNO IT operations managed services',
      businessScope: ['mobile'],
      domains: ['Digital', 'BSS', 'OSS', 'ITSM', 'API Gateway', 'Payments', 'MNP'],
      supportWindow: 'L1 24x7; L2 application 16x7 office plus on-call; L2 infrastructure/ITSM 16x5 plus on-call for P1/P2.',
      contractStatus: 'signed — WP1 11 Jun 2023, extended by Amendments 1-4; EXPIRED 20 Jun 2026 (no instrument after that date in the file set — renewal / RFP required)',
      contacts: [],
      escalation: [
        'P1/P2 incidents have on-call support outside office hours.',
        'Governance: operations daily + weekly, strategic monthly, Steering Committee monthly, Executive Connect quarterly (proposal §9.2). Dispute ladder: representatives 14 days -> CEOs 7 days -> SCCA arbitration Riyadh.',
        'Third-party, OEM, hardware, application bugs outside TCS control, planned downtime, and force majeure are excluded per proposal assumptions.'
      ],
      notes: 'Supply of Services Agreement SALAM-CONT-206-2022 (effective 10 Oct 2023) + WP1 MVNO IT Operations MS. Scope: L1 monitoring 24x7 (offshore), L2 application 16x7 + on-call, L2 infrastructure 16x5 + on-call, ITSM governance; Optiva stack, DMS, Digital Apps & Web Portal (StartAppz), Sadad/HyperPay gateways, Ameyo, Kong API GW, NetAxis MNP; 39 FTE (15 onsite / 24 offshore) to Dec 2025, 34 from Jan 2026 with Optiva application L2 removed (email evidence only — Amendment 4 carries no scope text). No clock-stop rule in any document.'
    }
  ],
  contracts: [
    {
      id: 'sigma-2024',
      vendorId: 'sigma',
      title: 'CONT-SALAM-167-2024 Sigma signed contract',
      businessScope: ['fixed', 'mobile'],
      domains: ['OSS', 'ITSM', 'DMS', 'Big data', 'Infrastructure', 'GIS', 'Remedy'],
      sourceDoc: 'CONT-SALAM-167-2024_Signed_Stmpd_SIGMA.pdf + First Addendum (Dec 2024) + Amendment 1 with Schedule 1 (Jun 2025) + First Addendum Digital (Aug 2025) + Third Addendum SharePoint (Nov 2025) + Fourth Addendum (Apr 2026)',
      sourcePages: 'Term cl.2; price App.A 1.1; invoicing cl.11; penalties §8.2.3 p.95-96 + cl.12; clock-stop §8.3; exemptions §8.4; governance §6.2; RACI §10; renewal SLA Schedule 1 §8.2.2',
      effectiveFrom: '2024-06-27',
      effectiveTo: '2026-06-30 (L1/L2 per RTP 37264) / 2026-08-31 (Fixed digital ops, Fourth Addendum) — renewal due',
      status: 'active — 6-month renewals',
      eligibleMonthlyFeeSar: 464100,
      monthlyPenaltyCapPercent: 40,
      penaltyMode: 'estimate_only',
      penaltyCap: 'No monthly cap in the contract: penalty % = SLA weight (response 1% / restoration 5% / resolution non-bug 1% / product-bug 1%) x impact index (1st miss 1, 2nd 2, 3rd 3, >3rd 5), deducted from the invoice of the reporting period — theoretical maximum 40% per period. Aggregate penalties capped at 10% of total Contract Price (cl.12: SAR 759,598 on 7,595,981). Availability 99.99% carries no penalty. Renewal Schedule 1 / Fourth Addendum restate targets WITHOUT the weight table — applicability after 27 Jun 2025 is ambiguous; validate.',
      financials: {
        currency: 'SAR', contractValueSar: 7595981, term: '12 months from 27 Jun 2024 + 1-month auto-renewals; prices protected 1 + 4 optional years; renewed in 6-month amendments',
        monthlyFeeSar: 464100, monthlyFeeBasis: 'Jan-Jun 2026 run-rate: RTP 37264 SAR 2,784,601.86 / 6 (L1/L2 ZSmart, Remedy, GIS, DMS, Big Data, Infra at Amendment-1 unit prices + Fixed digital ops 66,667/month). Year-1 OPEX was 4,769,205 (397,434/month); invoiced every 2 months in arrears on JCR, 30 days',
        yearly: { Y1_OPEX: 4769205, Y1_CAPEX_ADM: 2826776, H2_2025: 2384602, H1_2026: 2784602 },
        oneOffSar: 2826776, oneOffNote: 'CAPEX ADM points: ZSmart 10 CRs x 12,500; GIS 528 pts x 1,530; Remedy 264 x 2,040; DMS 264 x 1,700; Big Data 528 x 1,717 (1 point = 1 service day); minimum consumption billed every 2 months',
        paymentTerms: 'Undisputed invoices 30 days from receipt (cl.11); Third Addendum net 60; disputes 30 days then SCCA arbitration (Arabic); termination for convenience 30 days (cl.14.3)',
        manDayPool: 'ADM point rates: ZSmart CR 12,500; GIS 1,530 (list 1,800); Remedy 2,040 (2,400); DMS 1,700 (2,000); Big Data 1,717 (2,020); resource rates: Vanrise L2 64,976/month, HPE L2 57,526/month, SharePoint MS 35,714/month, Digital ops 66,667/month',
        amendments: [
          { ref: 'LoA SALAM-CONT-167-2024L', date: '2024-04-25', period: 'award', amountSar: 7595981, change: 'OPEX 4,769,205 + CAPEX 2,826,776; PO 22399 (27 Jun 2024, total incl. VAT 8,735,378.15)' },
          { ref: 'First Addendum REV.1', date: '2024-12-25', period: '12 months', amountSar: 1470041, change: 'Resources service: Vanrise Wholesale L2 SME 779,720 + HPE L2 SME 690,321; entity rename' },
          { ref: 'Amendment 1 + Schedule 1 (SALAM-CONT-167-2024-AMD.1-2025)', date: '2025-06-27', period: '2025-06-27 -> 2025-12-26', amountSar: 2384602, change: 'L1/L2 MS extended 6 months at 50% of year-1 OPEX; revised SLA: resolution non-bug 4h/6h/1BD/2BD, product-bug per L3 vendor SLA, onsite staffing 4 (bi-monthly), no weight table' },
          { ref: 'First Addendum — IT Digital Operations', date: '2025-08-01', period: '6 months', amountSar: 400000, change: 'Fixed digital channels (apps, infra, ITSM) 66,667/month' },
          { ref: 'Third Addendum — SharePoint', date: '2025-11-03', period: '3 months project + 12 months MS', amountSar: 768568, change: 'SharePoint 2010 -> SE upgrade 340,000 (25/30/45%) + MS onsite resource 428,568; net 60' },
          { ref: 'RTP 37264 (instrument not in file set)', date: '2026-03-12', period: '2026-01-01 -> 2026-06-30', amountSar: 2784602, change: 'L1/L2 + Digital extension' },
          { ref: 'Fourth Addendum (SALAM-CONT-097-2026)', date: '2026-04-29', period: '2026-03-01 -> 2026-08-31', amountSar: 400000, change: 'IT Digital Operations MS extended 6 months' }
        ],
        renewalDue: '2026-06-30 (L1/L2) — expired if not renewed; 2026-08-31 (Fixed digital ops)',
        liabilityCap: 'Sigma: fees paid (cl.16.1); Salam: SAR 1,000,000 (LoA 4.6)',
        sources: ['CONT-SALAM-167-2024 signed', 'LoA 25 Apr 2024', 'PO 22399', 'First Addendum Dec 2024', 'Amendment 1 + Schedule 1', 'Third Addendum', 'Fourth Addendum', 'RTPs 25558/25566/31531/34549/37264', 'Sigma performance report Jan-Jun 2025']
      }
    },
    {
      id: 'tcs-2026-mvno-itops',
      vendorId: 'tcs',
      title: 'SALAM-CONT-206-2022 Supply of Services Agreement — WP1 MVNO IT Operations Managed Services + Amendments 1-4',
      businessScope: ['mobile'],
      domains: ['Digital', 'BSS', 'OSS', 'ITSM', 'API Gateway', 'Payments', 'MNP'],
      sourceDoc: 'Service Agreement_Signed by TCS.pdf + MVNO Work Package_Signed by TCS.pdf + AMENDMENT 1-TCSWP-10JUL24 (binding SLA, §2.7 replaces proposal clause 11) + Amendments 2, 3, 4',
      sourcePages: 'Agreement cl.3 term, cl.12 payment, cl.14 termination, cl.30 disputes; WP1 §3 price, §6.2 penalties; Amendment 1 §2.2 penalty caps, §2.7 SLA tables, staffing sheet; Amendment 4 §2.6 (15-day termination)',
      effectiveFrom: '2023-06-11 (WP1; agreement effective 2023-10-10)',
      effectiveTo: '2026-06-20 (Amendment 4) — EXPIRED, renewal / RFP required',
      status: 'expired — awaiting renewal',
      eligibleMonthlyFeeSar: 697064,
      monthlyPenaltyCapPercent: 10,
      penaltyMode: 'estimate_only',
      penaltyCap: 'Amendment 1: aggregate service credits <= 10% of monthly charges; delay penalty 1%/week up to 10% of monthly charges; cumulative penalties <= 10% of Work Package price (WP1 original 5%/5% superseded). Base = monthly invoice value (SAR 896,232 to Dec 2025; SAR 697,064.22 from Jan 2026). First month of each extension is an SLA baseline month.',
      financials: {
        currency: 'SAR', contractValueSar: 31464361, term: 'WP1 12 months from 11 Jun 2023, then Amendments 1-4 in ~6-month steps to 20 Jun 2026; prices protected 2 years, year-3 uplift capped +5% offshore / +3% onsite',
        monthlyFeeSar: 697064, monthlyFeeBasis: 'Amendment 4 monthly instalment SAR 697,064.22 (L1 374,939 / L2 App 2,016,263 / L2 Infra 1,210,545 / ITSM 348,284 over 5 months 20 days); was SAR 896,232 per month Jun 2023 - Dec 2025',
        yearly: { WP1_2023_24: 10754787, AMD1_H2_2024: 6004756, AMD2_H1_2025: 4750031, AMD3_H2_2025: 6004756, AMD4_H1_2026: 3950031 },
        oneOffSar: 2364525, oneOffNote: 'WP2 Data Migration SOW (Optiva -> Oracle RODOD mapping), 26 Jan - 25 Jul 2025, 7 milestones, penalties 1%/week cap 10%; Amendment 1 to WP2 (ID 4316) body not in file set',
        paymentTerms: 'Monthly in arrears, undisputed invoices 30 days from receipt, JCR required; disputes 15 days; set-off right (cl.12.8); termination for convenience 90 days -> 15 days (Amendment 4 §2.6)',
        manDayPool: 'Lump-sum contract — no man-day rates found',
        amendments: [
          { ref: 'LoA SALAM-CONT-206-2022-L', date: '2022-11-24', period: '6-week transition + 12 months', amountSar: 10754787, change: 'Award (CEO approved 24 Nov 2022, budget SAR 10.0M)' },
          { ref: 'WP1 SALAM-CONT-206-2022-WP1', date: '2023-10-10', period: '2023-06-11 -> 2024-06-10', amountSar: 10754787, change: '12 x 896,232.25; L1 1,308,355 / L2 App 5,515,526 / L2 Infra 2,848,146 / ITSM 1,082,760; transition free' },
          { ref: 'Amendment 1', date: '2024-09-26', period: '2024-06-11 -> 2024-12-31', amountSar: 6004756, change: 'Replaces proposal SLA (clause 11) with new tables incl. per-system availability weights, charging KPIs, KT/resource SLAs; penalty caps 5% -> 10%; 39 FTE; change & release rollout support' },
          { ref: 'Amendment 2', date: '2024-11-25', period: '2025-01-01 -> 2025-06-10', amountSar: 4750031, change: 'Term extension' },
          { ref: 'Amendment 3', date: '2025-05-27', period: '2025-06-11 -> 2025-12-31', amountSar: 6004756, change: 'Term extension' },
          { ref: 'Amendment 4', date: '2025-12-31', period: '2026-01-01 -> 2026-06-20', amountSar: 3950031, change: 'Optiva application L2 removed (email evidence; 34 FTE, L2 App 16 -> 12); 15-day termination for convenience; monthly 697,064.22' },
          { ref: 'WP2 Data Migration SOW', date: '2024-11-11', period: '2025-01-26 -> 2025-07-25', amountSar: 2364525, change: 'Optiva -> Oracle data mapping, RTP 30863' }
        ],
        renewalDue: '2026-06-20 — EXPIRED in the file set; Salam intended early termination once UMS goes live; procurement required go-to-market for the post-Optiva scope',
        liabilityCap: 'Total liability capped at Work Package charges (cl.20.2); Salam may recover up to 15% of WP value for third-party completion (cl.14.6.2)',
        sources: ['Service Agreement signed', 'WP1 signed', 'LoA 24 Nov 2022', 'Amendment 1 (10 Jul 2024 draft, signed 26 Sep 2024)', 'Amendment 2', 'Amendment 3', 'Amendment 4 + CIO email chain Dec 2025', 'WP2 + RFQ 30863']
      }
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
      target: { P1: '4 hours (original contract: 2 h)', P2: '6 hours (original: 4 h)', P3: '1 business day', P4: '2 business days', note: 'Renewal SLA — Amendment 1 Schedule 1 §8.2.2 (27 Jun 2025) and Fourth Addendum App. A' },
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
      target: { P1: '1 day', P2: '3 days', P3: '7 days', P4: '12 days', note: 'Original contract p.95. Since the Jun 2025 renewal: "subject to existing L3 SLA contracts" (no fixed target); parallel L3 escalation required at 50% of the restoration clock' },
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
      target: { availability: '99.99% excl. planned outages, measured on P1 incidents excl. third-party outages', ORPO: '<10 min', ORTO: '<30 min', 'DR plan / drill': 'plan annually, runbook quarterly, full drill annually' },
      attainmentTarget: '99.99%',
      weight: 'no penalty weight in the contract (§8.2.4)',
      operatorMessages: {
        met: 'Availability is within Sigma target.',
        warning: 'Availability is close to monthly error budget.',
        breached: 'Availability breached; prepare outage window, approved exclusions, and RCA package.'
      },
      evidencePlan: ['probe uptime', 'alerts outage duration', 'maintenance windows', 'approved exclusions'],
      phase: 4
    },
    {
      id: 'sigma-staffing-reporting',
      vendorId: 'sigma',
      contractId: 'sigma-2024',
      category: 'governance',
      title: 'Onsite staffing, reporting and governance cadence',
      appliesTo: { business: ['fixed', 'mobile'], domains: ['OSS', 'ITSM', 'DMS', 'Infrastructure', 'Digital'] },
      target: { 'Onsite resources': '4 (bi-monthly measurement, renewal Schedule 1 §8.2.4)', 'SLA reports': 'daily / weekly / monthly', 'Infra reports': 'weekly issues, patches, incidents & changes; monthly assets, consumption, capacity, HW health', 'RCA': 'detailed root-cause report per incident — no deadline stated', 'Meetings': 'Operational weekly, Management monthly, Executive quarterly', 'Resource replacement': 'CV approval 14 days; replace on Salam request; sick cover at Sigma cost', 'Late delivery': 'penalty max 10% of total Contract Price (cl.12)' },
      attainmentTarget: 'per period',
      weight: 'none stated',
      operatorMessages: {
        met: 'Sigma staffing and reporting per contract.',
        warning: 'Onsite headcount below 4 or a periodic report missing.',
        breached: 'Staffing/reporting obligation missed; record in the monthly Management committee.'
      },
      evidencePlan: ['resource roster', 'report delivery log', 'committee minutes'],
      phase: 5
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
      target: { P1: '<48 hours from restoration (draft delivered and finalised)', P2: '<48 hours' },
      attainmentTarget: '95%',
      weight: { P1: '1%', P2: '1%' },
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
        DMS: '99.9% (weight 3%)',
        'Digital Apps (StartAppz)': '99.9% (3%)',
        'Web Portal (StartAppz)': '99.9% (1%)',
        'Payment gateway (Sadad / PG)': '99.9% (1%)',
        'Kong API Gateway (E&S)': '99.9% (3%)',
        'NetAxis MNP': '99.9% (1%)',
        'BSS DB / Reporting DB': '99.9% (3% / 1%)',
        'Backups & restore': '99.9% (1%, Major)',
        'Optiva stack (Lite CRM, URCS, ESB, SCL, SGW, NPG 3% each; Mediation, USSD, IHUB, Catalog, Voucher 1%; CPS 3%)': '99.9% — nominally still in Amendment 1; descoped from Jan 2026 per email only',
        formula: '(available minutes / expected minutes excl. planned downtime); excludes external systems, code bugs, deployments, platform bugs, non-TCS infrastructure'
      },
      attainmentTarget: '99.9% monthly',
      weight: 'per system 1-3% of monthly invoice (Amendment 1 availability table)',
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
        'Orders processed within 4 h (excl. MNP system outage)': '99% (Critical, 1%)',
        'ZATCA reconciliation': 'within 3 working days after bill cycle (Major, 1%)',
        'Daily Semati cancel notification': '97% (Major, 1%)',
        'New SIM activation within 30 s, all channels': '97% (Critical, 1%) — contract says 30 s, not 20 s',
        'New SIM activation within 60 s': '99% (Critical, 1%)',
        'Daily payments reconciliation (Sadad, Digital)': '98% (Critical, 3%)',
        'Postpaid subscribers invoiced': '99% (Critical, 1%)',
        'MNP T1 timer (respond within 30 min) / T2 (submit within 15 min)': '98% / 98% (Critical, 1% each)',
        'Prepaid MRC daily run / postpaid MRC monthly / bill run': '<= 8 h / <= 13 h / <= 7 h (1% each)',
        'Discarded mediation files': '<= 1% (Major, 1%)',
        'SIM swap': 'no SIM-swap KPI exists in any TCS document (removed)'
      },
      attainmentTarget: 'monthly, per KPI',
      weight: '1-3% of monthly invoice per KPI (Amendment 1 performance table)',
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
        'Onsite resource availability': '100% monthly, 1% per missing resource (leave/demise excepted)',
        'Required skills / resource numbers per tower': '100% (Major, 1% each)',
        'Knowledge transfer: SOP/RFC list': 'every 6 months (Critical, 1%); handed-over functions without vendor dependency 100% (1%)',
        'Backup success': '99% all systems — 98% warning; 97% SteerCo; <96% 0.5% of monthly payment; below target 3 periods in 12 months 2% (cap 5%)',
        'Security patching': 'critical/urgent immediately, others per plan — 1 non-core missed warning; 2 SteerCo; >2 non-core 0.5%; 1 core missed 2%',
        'Change management': '<= 2 failed deployments/month, else 1%',
        'User access review': 'quarterly, no system missed, else 1%',
        'MVNO link disconnection (FW policy / cert expiry)': '0, else 1%',
        'Monthly overview report': 'by 3rd business day; daily and weekly KPI reports'
      },
      attainmentTarget: 'monthly (access review quarterly, KT half-yearly)',
      weight: '0.5-2% of monthly payment per KPI (Amendment 1 governance table; legacy year-1 rows keep a 5% sub-cap)',
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
    penaltyRule('pen-sigma-response', 'sigma', 'sigma-2024', 'sigma-response', { weightPercent: 1, monthlyCapPercent: 40, breachFactor: 'impact index by occurrence of missing the 99% target: 1st = 1, 2nd = 2, 3rd = 3, >3rd = 5 (§8.2.3); occurrence reset period not stated', notes: 'Sigma response weight is seeded from the SLA item; confirm penalty conversion and cap from signed clause 12 / penalty schedule before enforcement.' }),
    penaltyRule('pen-sigma-restoration', 'sigma', 'sigma-2024', 'sigma-restoration', { weightPercent: 5, monthlyCapPercent: 40, breachFactor: 'impact index 1 / 2 / 3 / 5 by occurrence (example in contract: 2nd restoration miss = 5% x 2 = 10% of the invoice)', notes: 'Sigma restoration weight is seeded from the SLA item; confirm invoice base, cap and approved outage exclusions before enforcement.' }),
    penaltyRule('pen-sigma-resolution-non-bug', 'sigma', 'sigma-2024', 'sigma-resolution-non-bug', { weightPercent: 1, notes: 'Estimate only until Remedy/ITSM closure and approved clock-stop windows are imported.' }),
    penaltyRule('pen-sigma-resolution-product-bug', 'sigma', 'sigma-2024', 'sigma-resolution-product-bug', { weightPercent: 1, notes: 'Estimate only until vendor ticket lifecycle and release/change evidence are consistently linked.' }),
    penaltyRule('pen-sigma-availability', 'sigma', 'sigma-2024', 'sigma-availability', { calculationMethod: 'eligible_fee_x_availability_weight_x_chargeable_downtime_factor', weightPercent: null, notes: 'Availability penalty needs the signed availability weighting/tiering table and approved maintenance calendar.' }),
    penaltyRule('pen-tcs-response', 'tcs', 'tcs-2026-mvno-itops', 'tcs-response', { monthlyCapPercent: 10, severityWeights: { P1: 3, P2: 2, P3: 1, P4: 1 }, capBasis: 'Amendment 1: aggregate service credits <= 10% of monthly charges (WP1 5% superseded); cumulative <= 10% of WP price. Was: Proposal/reference cap: 5% monthly invoice cap; confirm final contract before enforcement.', notes: 'Response penalty is severity-weighted in the proposal reference; keep candidate-only until final commercial sign-off.' }),
    penaltyRule('pen-tcs-restoration', 'tcs', 'tcs-2026-mvno-itops', 'tcs-restoration', { monthlyCapPercent: 10, severityWeights: { P1: 7, P2: 5, P3: 2, P4: 1 }, capBasis: 'Amendment 1: aggregate service credits <= 10% of monthly charges (WP1 5% superseded); cumulative <= 10% of WP price. Was: Proposal/reference cap: 5% monthly invoice cap; confirm final contract before enforcement.', notes: 'Restoration penalty needs verified incident restoration timestamps and exclusion review.' }),
    penaltyRule('pen-tcs-rca', 'tcs', 'tcs-2026-mvno-itops', 'tcs-rca', { monthlyCapPercent: 10, weightPercent: 1, calculationMethod: 'measure_report_candidate_only', notes: 'RCA is measure/report only in the current reference; do not convert to penalty until governance confirms.' }),
    penaltyRule('pen-tcs-availability', 'tcs', 'tcs-2026-mvno-itops', 'tcs-availability', { monthlyCapPercent: 10, weightPercent: null, calculationMethod: 'eligible_fee_x_system_availability_weight_x_chargeable_downtime_factor', notes: 'Availability weight varies by system in the reference; requires system ownership, outage windows and planned exclusions.' }),
    penaltyRule('pen-tcs-performance-orders', 'tcs', 'tcs-2026-mvno-itops', 'tcs-performance-orders', { monthlyCapPercent: 10, weightPercent: null, calculationMethod: 'performance_sla_tiering_required', notes: 'Performance penalties need metric-specific tiering and exact Digital/APIGW/OSB/BSS evidence confidence before scoring.' }),
    penaltyRule('pen-tcs-governance', 'tcs', 'tcs-2026-mvno-itops', 'tcs-governance', { monthlyCapPercent: 10, weightPercent: null, calculationMethod: 'governance_report_candidate_only', notes: 'Governance KPIs are tracked for service review until monthly vendor-report import and penalty eligibility are approved.' })
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

require('./vendorContractsSeedExt').applyExt(DEFAULT_CONFIG);

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
    penaltyCap: text(c.penaltyCap || base.penaltyCap, 1200),
    financials: (c.financials && typeof c.financials === 'object') ? c.financials : (base.financials || null)
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
    version: 4,
    sourceNote: text(raw.sourceNote || defaults.sourceNote, 1200),
    phases,
    vendors,
    contracts: mergeDefaults(defaults.contracts, raw.contracts, normalizeContract),
    /* merged by id (24 Sep 2026): a saved config keeps its edits, and vendors/obligations added to the
     * defaults later (Oracle, Subex, Comviva, Infosys, Evamp) appear without a "Reset defaults" */
    obligations: mergeDefaults(defaults.obligations, raw.obligations, (o, base) => ({ ...base, ...o })),
    assignments: mergeDefaults(defaults.assignments, raw.assignments, (a, base) => ({ ...base, ...a })),
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
