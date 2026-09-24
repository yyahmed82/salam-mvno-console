/* vendorContractsSeedExt.js — vendors added to the governance model on 24 Sep 2026 from the SIGNED documents
 * (contract register export + the contract PDFs for IDs 2289/3319/3756/3956/4016/4029/4674/4686 Oracle,
 * 1826/1897/2178/3092/4651 Subex, 3369/4573 Comviva, 4116/4278/4611 Infosys, 4314 Evamp & Saanga).
 *
 * Every figure below is quoted from the document named in `sourceDoc` / `financials.sources`; anything the
 * documents do not state is written as null or "not found", never guessed. Penalty inputs stay estimate-only
 * (penaltyGovernance.mode) until commercial validation, exactly like Sigma and TCS.
 *
 * Shape: the same objects vendorContracts.js DEFAULT_CONFIG uses — vendors, contracts (+ `financials`),
 * obligations, assignments, escalationFlows, evidenceMappings, penaltyRules — merged by id in applyExt(). */
'use strict';

const clone = v => JSON.parse(JSON.stringify(v));

/* reminder ladders mirror the contractual response clocks: a reminder before the clock runs out, one at it,
 * one after; management copied on P1/P2 */
const ORACLE_POLICY = {
  P1: { reminder1Min: 10, reminder2Min: 15, reminder3Min: 30, repeat3Min: 60, informManagement: true },
  P2: { reminder1Min: 20, reminder2Min: 30, reminder3Min: 60, repeat3Min: 120, informManagement: true },
  P3: { reminder1Min: 45, reminder2Min: 60, reminder3Min: 240, repeat3Min: 0, informManagement: false },
  P4: { reminder1Min: 180, reminder2Min: 240, reminder3Min: 480, repeat3Min: 0, informManagement: false }
};
const SUBEX_POLICY = {
  P1: { reminder1Min: 20, reminder2Min: 30, reminder3Min: 60, repeat3Min: 120, informManagement: true },
  P2: { reminder1Min: 20, reminder2Min: 30, reminder3Min: 120, repeat3Min: 240, informManagement: true },
  P3: { reminder1Min: 180, reminder2Min: 240, reminder3Min: 480, repeat3Min: 0, informManagement: false },
  P4: { reminder1Min: 1440, reminder2Min: 2880, reminder3Min: 7200, repeat3Min: 0, informManagement: false }
};
const GENERIC_POLICY = {
  P1: { reminder1Min: 15, reminder2Min: 30, reminder3Min: 60, repeat3Min: 60, informManagement: true },
  P2: { reminder1Min: 30, reminder2Min: 60, reminder3Min: 120, repeat3Min: 120, informManagement: true },
  P3: { reminder1Min: 120, reminder2Min: 240, reminder3Min: 480, repeat3Min: 0, informManagement: false },
  P4: { reminder1Min: 480, reminder2Min: 1440, reminder3Min: 2880, repeat3Min: 0, informManagement: false }
};
const item = (obligationId, policy, message) => ({ obligationId, enabled: true, severityPolicy: clone(policy), ownerHint: 'L1 -> L2/vendor owner -> service delivery -> management', message });
const ev = (id, obligationId, sources, primarySource, metric, calculation, surface, readiness, confidence, controls, nextStep) =>
  ({ id, obligationId, sources, primarySource, metric, calculation, surface, readiness, confidence, controls, nextStep });
const pen = (id, vendorId, contractId, obligationId, o = {}) => ({
  id, vendorId, contractId, obligationId, enabled: o.enabled !== false, mode: o.mode || 'estimate_only',
  calculationMethod: o.calculationMethod || 'eligible_fee_x_weight_x_breach_factor',
  eligibleFeeBasis: o.eligibleFeeBasis || 'Monthly in-scope fee for this contract as stated in financials.monthlyFeeSar; validate with the commercial owner.',
  monthlyCapPercent: o.monthlyCapPercent == null ? null : o.monthlyCapPercent,
  capBasis: o.capBasis || 'Apply the contract cap after summing validated candidates.',
  weightPercent: o.weightPercent == null ? null : o.weightPercent,
  severityWeights: o.severityWeights || null,
  breachFactor: o.breachFactor || '1.0 for each validated monthly SLA miss.',
  statusFlow: ['informational', 'candidate_breach', 'validated_breach', 'excluded', 'approved_governance', 'approved_penalty'],
  approvalStatus: 'commercial_validation_required',
  notes: o.notes || ''
});

const vendors = [
  {
    id: 'oracle', name: 'Oracle', legalName: 'Oracle Systems Limited (Riyadh)', type: 'BSS/OSS managed services + transformation + licences',
    businessScope: ['fixed', 'mobile'], domains: ['BSS', 'OSS', 'Siebel', 'BRM', 'OSM', 'UIM', 'ASAP', 'OSB', 'ERP', 'Edge Catalyst'],
    supportWindow: 'L1 monitoring/triage 24x7; incident management business hours with 24x7 on-call for Severity 1 & 2; major outage management 24x7 (MS OD Table 12).',
    contractStatus: 'signed (MS OD approved Jul 2023; executed copy not in file set)', contacts: [],
    escalation: ['Oracle Service Delivery Manager (SPOC) <-> Salam Customer Operations Manager; repeated SLA misses go to the monthly Steering Committee, which issues official warning letters.',
      'Security incidents to soc@salam.sa. Shared root cause = only the highest single credit applies.'],
    notes: 'Managed Services OD SAL-14253496 (Apollo B2B RODOD stack + Releases 1-7: MVNO B2B/B2C, Mobily MVNO, 5G FWA, FTTH migration, Siebel/UIM upgrade). Edge Catalyst OD SAL-19029527 (legacy B2B -> Apollo) is in delivery with a live milestone-delay dispute (SAR 557,550 claimed 30 Mar 2026). Enterprise ULA CPQ-3962932-1 effective 31 Aug 2025 keeps Premier Support, which the MS OD makes a precondition of the 99.999% charging availability.'
  },
  {
    id: 'subex', name: 'Subex', legalName: 'Subex (UK) Limited', type: 'RAFM platform subscription + managed service',
    businessScope: ['fixed', 'mobile'], domains: ['Revenue Assurance', 'Fraud Management', 'HyperSense', 'Migration assurance'],
    supportWindow: 'FM application managed service L1/L2 24x7x365 and L3 24x7 for P1/P2 (Amendment 1, from 1 Aug 2024); RA managed service coverage as per base contract (Schedule A not in file set).',
    contractStatus: 'signed', contacts: [],
    escalation: ['Nominated representatives -> 14 days -> written Notice -> senior executives within 7 days -> 30 days amicable -> LCIA arbitration (London).',
      'Three consecutive months below the 99% availability SLA = material breach (Amendment 1).'],
    notes: 'SALAM-CONT-138-2022 Subscription & Implementation Services Agreement for RA & FM (MVNO, B2C, B2B) on HyperSense, on-premises; 5 years from project kick-off (kick-off date not in the file set). Registered as "Subax" in the contract register. Separate migration-assurance engagements per Oracle Impact release (R4 done, R5/R6 approved May 2026, USD 178,843).'
  },
  {
    id: 'comviva', name: 'Comviva', legalName: 'Comviva Technologies Limited (Gurugram, India)', type: 'Dealer & commission management system (DMS) — implementation + subscription + managed service',
    businessScope: ['fixed', 'mobile'], domains: ['DMS', 'Commission', 'Dealer portal', 'Indirect sales app'],
    supportWindow: 'Offsite managed service L2 8x5 remote, L3 if needed, L4 product support/preventive maintenance remote (Year 1 FOC, Years 2-5 priced).',
    contractStatus: 'LoA signed 1 Jun 2026; definitive agreement due within 30 days (not in file set)', contacts: [],
    escalation: ['No operational SLA/escalation matrix in the LoA, BOQ or TER — expected in Annexure-1 / definitive agreement.', 'Cyber breach: immediate notification to Salam Sr. Director Cybersecurity (LoA 4.10).'],
    notes: 'RFP 197-2024 "Blue Marble" replaces DRM (IWC), the MVNO DMS (Evamp & Saanga TeC DMP), SDA and the Indirect Sales Portal for mobility + fixed. 10-month build from Work Commencement Date (mobilisation within 4 weeks of PO); managed service starts at the last PAC. Governing law England & Wales (unusual for Salam).'
  },
  {
    id: 'infosys', name: 'Infosys', legalName: 'Branch of Infosys Limited for Communication and Information Technology (Al Khobar)', type: 'Testing Centre of Excellence managed service; Apollo upgrade programme',
    businessScope: ['fixed', 'mobile'], domains: ['Testing', 'Test automation', 'DevSecOps', 'BSS', 'OSS', 'Digital', 'Rimal DC'],
    supportWindow: 'Onsite Riyadh Sun-Thu 8 h/day (7 FTE), offshore India 8.8 h/day (8 FTE); 315 man-days/month baseline; beyond-hours on <= 48 h notice.',
    contractStatus: 'signed (TCoE MS 3 Nov 2025); Rimal DC upgrade LoA draft 20 May 2026', contacts: [],
    escalation: ['Delivery Review weekly/fortnightly -> Program Review monthly -> Strategic Review quarterly; disputes: reps 14 wd -> Notice -> senior executives 7 wd -> Riyadh courts after 21 wd.',
      'Consistent breach of the ** SLAs (Defect Removal Efficiency, Test Cycle Adherence, Regression Automation) for 3 consecutive months = termination right.'],
    notes: 'SALAM-CONT-187-2025 TCoE MS: WP1-A process definition (TMMi), WP1-B managed testing for BAU + transformation (BSS/OSS/ESS/Digital), WP2 Tricentis qTest/Tosca/NeoLoad, WP3 GitLab Ultimate DevSecOps. RFP 214-2025 Apollo upgrade to N/N-1 in Rimal DC (SAR 7,601,251, 10 months, go-live clawback clause).'
  },
  {
    id: 'evamp', name: 'Evamp & Saanga', legalName: 'Evamp & Saanga', type: 'OEM L3 support & maintenance — TeC DMP (MVNO DMS) and UIL/DIB integration layer',
    businessScope: ['mobile'], domains: ['DMS', 'UIL', 'Dealer app', 'Commission engine'],
    supportWindow: 'L3 (bug fixes, security patches, product updates) under annual subscription; L1/L2 optional; P1 worked 24/7 continuous effort (proposal 4.4.5).',
    contractStatus: 'single-source stage (SSD Dec 2025, USD 349,000 / year); no PO or contract in file set', contacts: [],
    escalation: ['P1 -> L3 Ops -> Project Director -> VP Operations -> Salam CIO/CEO; P2 up to VP Operations; P3 up to Account Manager (proposal).', 'Source-code escrow: release if E&S ceases operations, fails support > 60 consecutive days or uncured material breach.'],
    notes: 'Bridge contract after Optiva decommissioning: 1 year from takeover with termination for convenience once the Comviva DMS (RFP 197) goes live. SLA response/resolution table and budgetary quotation are images in the proposal — hours not extracted. Contract ID 1863 in the register is an EY Design Studio engagement (2022), not Evamp & Saanga.'
  }
];

const contracts = [
  {
    id: 'oracle-ms-od-14253496', vendorId: 'oracle', title: 'SAL-OD-14253496 Managed Services Ordering Document (Apollo B2B + Releases 1-7)',
    businessScope: ['fixed', 'mobile'], domains: ['BSS', 'OSS', 'Siebel', 'BRM', 'OSM', 'UIM', 'ASAP', 'OSB'],
    sourceDoc: 'SAL-OD-14253496-Integrated Telecom Company-v9.pdf (contract ID 2289)', sourcePages: 'Scope Table 1; service hours Table 12; severities Table 10; SLA Tables 13-15; KPIs Annex 4; rate card Annex 5; governance Annex 3',
    effectiveFrom: '2023-10-01 (implied by payment calendar Y1 Q1 = Oct-Dec 2023)', effectiveTo: '2028-09-30 (implied; 63 months incl. 3-month transition)', status: 'active',
    eligibleMonthlyFeeSar: 916000, monthlyPenaltyCapPercent: 10, penaltyMode: 'estimate_only',
    penaltyCap: 'Service credits capped at 10% of the monthly fee in any month and 10% of total order fees in aggregate; sole and exclusive remedy; applicable from 90 days after first go-live / end of transition; shared root cause -> highest credit only (OD A.10, Annex 2 1.12).',
    financials: {
      currency: 'SAR', contractValueSar: 74500000.03, term: '63 months (3-month transition + 60 months services)',
      monthlyFeeSar: 916000, monthlyFeeBasis: 'Apollo B2B base SAR 2,098,047.68/quarter (~699,349/month) + Exhibit 2 app-dev pool SAR 650,008.64/quarter (~216,670/month); release fees (R1-R7) start at handover on top',
      yearly: { Y1: 13220826.34, Y2: 15261871.86, Y3: 15339100.61, Y4: 15339100.61, Y5: 15339100.61 },
      oneOffSar: 849516.24, oneOffNote: 'one-time set-up',
      paymentTerms: 'Quarterly in arrears, net 60 days; PO issued yearly (Year-1 RTO SAR 13.22M); termination for convenience 45 business days',
      manDayPool: '2,000 person-days/year (Ex.2, forfeited if unused) + 24 operational CR days/month; ODA1 SAL-18719637: 5,000 PD SAR 6,500,000 (SAR 1,300/PD) 1 Aug 2025 -> 30 Apr 2026, extended by ODA2 SAL-21104968 to 31 Oct 2026 at no cost; earlier 5,000-MD bucket (ID 3319) approved Nov 2024 at SAR 1,360/MD',
      rateCard: 'Annex 5, 60 months: offshore Sr Principal SAR 2,060/day, Principal 1,388; onsite Sr Principal 3,520, Principal 2,701',
      amendments: [
        { ref: 'ID 3319', date: '2024-11-14', period: '24 months', amountSar: 6800000, change: '5,000 man-days for IMPACT (2,500 committed + 2,500 optional) at SAR 1,360/MD, consumption-based' },
        { ref: 'ODA1 SAL-18719637 (ID 4016)', date: '2025-08-25', period: '2025-08-01 -> 2026-04-30', amountSar: 6500000, change: 'Exhibit 3: 5,000 additional person-days at SAR 1,300/PD; work-at-risk from 30 Jul 2025' },
        { ref: 'ODA2 SAL-21104968 (ID 4686)', date: '2026-06 (offer valid to 30 Jun 2026)', period: '-> 2026-10-31', amountSar: 0, change: 'Exhibit 3 validity extended from 9 to 15 months' },
        { ref: 'OMA Amendment Two (ID 3756)', date: '2025-05', period: 'master agreement 5 -> 10 years', amountSar: 0, change: 'Extends Oracle Master Agreement SS-OMA-CPQ-1666061 term' }
      ],
      renewalDue: '2028-09-30 (services); man-day pool validity 2026-10-31',
      liabilityCap: 'not found in extraction',
      sources: ['SAL-OD-14253496 v9', 'CIO approval thread Jul 2023', 'PO issuance clarification 13 Jul 2023', 'SAL-ODA1-18719637 v6', 'SAL-ODA2-21104968 v3']
    }
  },
  {
    id: 'oracle-edge-catalyst-19029527', vendorId: 'oracle', title: 'SAL-OD-19029527 Edge Catalyst — legacy B2B fixed services to Apollo (+ SIP/CUC)',
    businessScope: ['fixed'], domains: ['Siebel', 'BRM', 'OSM', 'UIM', 'ASAP', 'B2B migration'],
    sourceDoc: 'SAL-OD-19029527-Etihad Salam Telecom Company-v7.pdf (ID 3956); delay dispute file ID 4674', sourcePages: 'Exhibit 1 milestones; Exhibit 2 SIP/CUC; Exhibit 3 T&M; penalties §10',
    effectiveFrom: '2025-10-01 (kick-off)', effectiveTo: 'milestone-based; R1 go-live 2026-07-23 at risk, R2 2026-11-19 delayed (Salam plan May 2026)', status: 'in delivery — milestone-delay dispute open',
    eligibleMonthlyFeeSar: null, monthlyPenaltyCapPercent: null, penaltyMode: 'estimate_only',
    penaltyCap: 'Late milestone 1% of milestone value per week + 1% for failed success criteria; cap SAR 1,575,000 (Ex.1) and SAR 420,000 (Ex.2); sole remedy. Salam claim 30 Mar 2026: SAR 557,550 (R1 RD.140 18 wks, R1 DS.140 14 wks, R2 RD.140 16 wks, R2 DS.140 19 wks, R3 RD.140 9 wks); Oracle rejected 16 Apr 2026; Salam maintained 1 Jun 2026.',
    financials: {
      currency: 'SAR', contractValueSar: 23173000, term: 'Ex.1/Ex.2 milestone-based (~14 months indicative); Ex.3 12 months',
      monthlyFeeSar: null, monthlyFeeBasis: 'not a recurring contract',
      oneOffSar: 19950000, oneOffNote: 'Ex.1 SAR 15,750,000 (17 milestones) + Ex.2 SAR 4,200,000 (7 milestones)',
      manDayPool: 'Ex.3 up to 2,000 person-days at SAR 1,611.50/day (est. SAR 3,223,000), monthly invoicing',
      paymentTerms: 'Per milestone on acceptance (10 business days deemed acceptance); fees non-cancellable once complete',
      amendments: [],
      renewalDue: 'n/a — programme; penalty claim SAR 557,550 pending',
      liabilityCap: 'not found in extraction',
      sources: ['SAL-OD-19029527 v7', 'Single Source TEM v7 (Feb 2025)', 'Salam feedback deck 19 May 2026', 'Oracle response 15 Apr 2026', 'Salam letter 016-2/SALAM-CONT-1666061 1 Jun 2026']
    }
  },
  {
    id: 'oracle-ula-3962932', vendorId: 'oracle', title: 'CPQ-3962932-1 Enterprise Unlimited Licence Agreement (Siebel, BRM/ECE, OSM, UIM, ASAP, IPSA...)',
    businessScope: ['fixed', 'mobile'], domains: ['Licences', 'Support'],
    sourceDoc: 'Oracle Ordering Document_ULA_Salam_20 Aug 2025.pdf (ID 4029) + Payment Schedule 254425 + Business Case v6', sourcePages: 'Products list; fees; support uplift; certification',
    effectiveFrom: '2025-08-31', effectiveTo: '2030-08-31 (5-year unlimited deployment period; certification within 30 days after)', status: 'active',
    eligibleMonthlyFeeSar: null, monthlyPenaltyCapPercent: null, penaltyMode: 'not_applicable',
    penaltyCap: 'Licence agreement — no SLA. Support is the precondition for the MS OD 99.999% charging availability (Assumption L).',
    financials: {
      currency: 'SAR', contractValueSar: 50268353.24, term: '5 years', monthlyFeeSar: null,
      monthlyFeeBasis: 'Support stream SAR 13,117,098.15/year from renewal year 1, 0% uplift years 1-4 (~SAR 1,093,092/month equivalent); year-1 support annually in advance, years 2-5 quarterly in advance',
      oneOffSar: 35648607.75, oneOffNote: 'Program (licence) fees; plus new support 4,057,736.62, converted support 7,397,745.35, restated support 1,661,616.18, reinstatement 2,668,054.27, credit -1,165,406.93',
      paymentTerms: 'PS 254425: SAR 6,534,885.92 (1 Nov 2025), 11,059,037.71 (15 Jan 2026), 13,572,455.37 (1 May 2026), 19,101,974.23 (15 Jan 2027)',
      amendments: [], renewalDue: '2030-08-31 certification', liabilityCap: 'not found',
      sources: ['ULA OD 20 Aug 2025', 'Letter of Clarification No.1 22 Aug 2025', 'Business case v6 (5-yr TCO SAR 101.14M)', 'Budget allocation approval 7 Oct 2025']
    }
  },
  {
    id: 'subex-138-2022', vendorId: 'subex', title: 'SALAM-CONT-138-2022 RAFM Subscription & Implementation Services Agreement + First Amendment (24x7 FM MS)',
    businessScope: ['fixed', 'mobile'], domains: ['Revenue Assurance', 'Fraud Management', 'HyperSense'],
    sourceDoc: 'SALAM-CONT-138-2022 Signed 20 pages.pdf + AMENDMENT 1 stamped final (ID 3092)', sourcePages: 'Price §5; term §3; milestones §7; LDs §15; Amendment 1 §2 (hours, SLA matrix), §3-4 (availability 99% + credits), §5.2 (CR buckets)',
    effectiveFrom: '2023-06-12 (Effective Date; 5-year term runs from project kick-off — date not in file set)', effectiveTo: '~2028 (5 years from kick-off; auto-renews 12 months unless 30 days notice)', status: 'active',
    eligibleMonthlyFeeSar: 152114, monthlyPenaltyCapPercent: 10, penaltyMode: 'estimate_only',
    penaltyCap: 'Availability: 1% of the monthly subscription fee per 1% below 99%, cap 10% of that monthly fee, credited against future payments, sole liability; 3 consecutive months = material breach. Delay LDs 1%/week of milestone value, cap 10%. Support response SLAs (P1-P4) carry no penalty. Base "monthly subscription fee" is undefined (licence ~31,345/month vs MS ~113,347/month) — validate.',
    financials: {
      currency: 'SAR', contractValueSar: 10853332.94, term: '5 years from kick-off; FM managed service 54 months from FM hypercare certificate, RA managed service 38 months from RA hypercare certificate',
      monthlyFeeSar: 152114, monthlyFeeBasis: 'FM MS 53,581.67 + Amendment 1 24x7 uplift 59,765.37 + HyperSense L3 Platinum 7,421.88 + licence subscription 31,344.95 (376,139.40/yr) = 152,114/month; RA MS 62,010.13/month for 38 months on top while it runs. Set the exact eligible base with Finance.',
      yearly: { Y1: 2162997.89, Y2: 3115846.78, Y3: 1701230.87, Y4: 1763241.00, Y5: 2110016.40 },
      oneOffSar: 3735910.21, oneOffNote: 'Implementation FM 1,303,581.87 + RA 2,000,727.34 + set-up 430,601 (milestones 20% BRD / 25% design / 30% PAC / 25% hypercare); training FM 80,000 + RA 96,000',
      paymentTerms: '30 days from valid invoice; nothing payable before PAC; licence quarterly in advance; MS quarterly in arrears; termination for convenience 60 days',
      manDayPool: 'Amendment 1 CR buckets at Salam discretion: 500 MD SAR 892,857 (1,785.71/MD) / 800 MD SAR 1,357,143 (1,696.43/MD) / 1000 MD SAR 1,696,429; consume within 24 months; PO issuance not evidenced',
      amendments: [
        { ref: 'First Amendment', date: '2024-08-01', period: '54 months from 1 Aug 2024', amountSar: 3628111, change: 'FM MS L1/L2 8x5 -> 24x7x365 (+59,765.37/month), L3 Platinum (+7,421.88/month), new P1-P4 SLA matrix, 99% availability SLA with service credits, CR bucket options, entity rename' },
        { ref: 'Migration Assurance R5/R6 (ID 4651)', date: '2026-05-05', period: '10 weeks (usable within 4 months)', amountSar: null, change: 'USD 178,843 separate engagement: 4 dry runs, 124 KPIs, Go/No-Go reports for Whale Cloud -> Oracle BRM migration of R5 (5G FWA) and R6 (FTTx); milestones 30/25/25/20%' }
      ],
      renewalDue: '~2028 (kick-off + 5 years) — confirm kick-off date; non-renewal notice 30 days before expiry, price discussion 6 months before',
      liabilityCap: 'Subex: charges paid in last 12 months; Salam: charges payable (§23.2)',
      sources: ['SALAM-CONT-138-2022 signed', 'Amendment 1 signed', 'TER 138-2022 (22 May 2023)', 'Subex MS upgrade commercial proposal 14 Jul 2024', 'R5/R6 migration assurance proposal 5 May 2026']
    }
  },
  {
    id: 'comviva-197-2024', vendorId: 'comviva', title: 'SALAM-CONT-197-2024L LoA — Sales, Commissioning & Dealer Management System (Blue Marble)',
    businessScope: ['fixed', 'mobile'], domains: ['DMS', 'Commission', 'Dealer portal'],
    sourceDoc: 'LOA RFP 197 2025 LOAward 1June2026 Final.pdf + BOQ and Compliance Sheet + TER 18 May 2026 (ID 4573)', sourcePages: 'LoA §1 schedule, §2.1 BOQ, §3 payment, §4.2 delay penalty, §4.3-4.5 termination/liability/law',
    effectiveFrom: '2026-06-01 (LoA); Work Commencement = PO/contract + 4 weeks mobilisation', effectiveTo: 'implementation 10 months from WCD; subscription + managed service years 2-5 (5-year price protection)', status: 'LoA — definitive agreement pending',
    eligibleMonthlyFeeSar: 91975, monthlyPenaltyCapPercent: null, penaltyMode: 'estimate_only',
    penaltyCap: 'Implementation delay: 1% of the payment-milestone amount per week, cap 10% of PO amount, and/or termination; only for delay solely attributable to Comviva (LoA 4.2). No operational SLA (availability / response / resolution) in LoA, BOQ or TER — must come from Annexure-1 / definitive agreement. Liability cap SAR 1,000,000 per party.',
    financials: {
      currency: 'SAR', contractValueSar: 6113998, term: '5-year TCO; prices fixed 5 years from WCD; POs year by year',
      monthlyFeeSar: 91975, monthlyFeeBasis: 'Year-2 run-rate: licence subscription 788,700 + offsite managed service 315,000 = 1,103,700/12; falls to 717,090/yr (59,758/month) by Year 5',
      yearly: { Y1: 2560028, Y2: 1103700, Y3: 990090, Y4: 743090, Y5: 717090 },
      oneOffSar: 2560028, oneOffNote: 'Professional services 2,097,628 (BRSD 15% / HLD-LLD 15% / build 25% / E2E test 15% / UAT 20% / handover 10%) + on-site resource 57,800 x 8 months = 462,400',
      paymentTerms: 'Milestones against JCR; licences 100% on activation then annually from year 2, 30 days; managed service quarterly in arrears; other invoices 60 days',
      manDayPool: 'Extra on-site resources at Comviva rate card (not provided)',
      amendments: [], renewalDue: 'Definitive agreement was due ~1 Jul 2026 (30 days after LoA); CCO approval only 29 Jul 2026 — confirm signature',
      liabilityCap: 'SAR 1,000,000 per party; no consequential loss',
      sources: ['LoA 1 Jun 2026', 'BOQ & compliance sheet', 'TER 18 May 2026', 'PID 28 Nov 2024 (budget SAR 10M)']
    }
  },
  {
    id: 'infosys-187-2025', vendorId: 'infosys', title: 'SALAM-CONT-187-2025 IT Testing Centre of Excellence Managed Service (TCoE MS)',
    businessScope: ['fixed', 'mobile'], domains: ['Testing', 'Test automation', 'DevSecOps'],
    sourceDoc: 'SALAM-CONT187 2025 Final Signed by Infosys.pdf (ID 4278) + LoA 3 Nov 2025 with clause 3.5 (ID 4116)', sourcePages: 'Price cl. 4; payment cl. 6; delay cl. 14; liability cl. 22; Schedule A commercial T&C §4 SLA weightages',
    effectiveFrom: '2025-11-03', effectiveTo: '2028-11-03 (cl. 5.2: 3 years from Effective Date; cl. 5.1.1 says from Work Commencement Date ~Dec 2025 — ambiguity)', status: 'active',
    eligibleMonthlyFeeSar: 228848, monthlyPenaltyCapPercent: 10, penaltyMode: 'estimate_only',
    penaltyCap: 'SLA credits assessed monthly per demand/release on the SLA weightages (sum 13%), cap 10% of total SLA weightage per month; +1% per additional breach; failure to enable SLA measurement by end of transition = maximum monthly penalty. Delay: 1% of Contract Price per week, cap 10%. ** SLAs breached 3 consecutive months = termination right.',
    financials: {
      currency: 'SAR', contractValueSar: 10480527, term: '3 years',
      monthlyFeeSar: 228848, monthlyFeeBasis: 'Managed-service monthly fee for 315 man-days: Y1 228,848 / Y2 204,091 / Y3 196,799 (blended SAR 726 / 648 / 625 per man-day); licences invoiced 100% in month 1 of each year (934,098 / 973,893 / 1,015,670)',
      yearly: { Y1: 3680280, Y2: 3422986, Y3: 3377261 },
      oneOffSar: 1292995, oneOffNote: 'WP1-A TCoE process definition (Y1 milestones M2-M7) + WP2/WP3 tooling milestones',
      paymentTerms: 'Monthly against JCR, net 60 days; quarterly reconciliation of man-days vs 315 baseline (baseline may be reduced 20%); volume discounts 10/15/20% on incremental scope; termination for convenience 90 days',
      manDayPool: '315 man-days/month baseline; extra man-days at baseline rates by PO',
      amendments: [{ ref: 'LoA clause 3.5 (28 Oct 2025)', date: '2025-10-28', period: '-', amountSar: null, change: 'Infosys aggregate liability cap SAR 5,240,264 (50% of price) or last-18-months payments, whichever higher' }],
      renewalDue: '2028-11 (confirm cl. 5.1.1 vs 5.2)',
      liabilityCap: 'Infosys SAR 5,240,264 or preceding 18 months payments (higher); Salam SAR 1,000,000',
      sources: ['Signed contract 3 Nov 2025', 'LoA with clause 3.5', 'TER 187-2024 (24 Sep 2025)', 'BAFO 22 Sep 2025', 'RTP 30750 (budget SAR 19,450,000)']
    }
  },
  {
    id: 'infosys-214-2025', vendorId: 'infosys', title: 'SALAM-CONT-214-2025L Apollo upgrade to N/N-1 in Rimal DC (Program 2)',
    businessScope: ['fixed', 'mobile'], domains: ['BSS', 'OSS', 'Rimal DC', 'Upgrade'],
    sourceDoc: 'LOA InfoSys RFP214 2025 (draft 20 May 2026) + Annexure 1 + TER 214-2025 (ID 4611)', sourcePages: 'LoA 2.1.1 milestones; 2.3 clawback; 3.3 delay penalty; 3.5-3.6 liability; Annex §3.7 warranty',
    effectiveFrom: '2026-05 (LoA draft; mobilisation within 8 weeks)', effectiveTo: '10 months (7 upgrade + 3 hypercare)', status: 'LoA draft — unsigned in file set',
    eligibleMonthlyFeeSar: null, monthlyPenaltyCapPercent: null, penaltyMode: 'estimate_only',
    penaltyCap: 'Delay 1% of PO amount per week, cap 10%; if M7 Go-Live is missed Salam may claw back all M1-M6 payments (up to 55% = SAR 4,180,688) within 30 days or set off; Infosys liability cap = contract price SAR 7,601,251.',
    financials: {
      currency: 'SAR', contractValueSar: 7601251, term: '10 months', monthlyFeeSar: null, monthlyFeeBasis: 'milestone-based programme',
      oneOffSar: 7601251, oneOffNote: 'M1 5% / M2 10% / M3 10% / M4 10% / M5 10% / M6 10% / M7 go-live 25% (1,900,312) / M8 hypercare 10% / M9 5% / M10 5%',
      paymentTerms: '100% on completion & acceptance per milestone, monthly vs JCR, net 60 days', amendments: [],
      renewalDue: 'n/a', liabilityCap: 'Infosys SAR 7,601,251; Salam SAR 1,000,000',
      sources: ['LoA draft 20 May 2026', 'Annexure 1', 'TER 214-2025 (4 May 2026)', 'PID 4043 (budget SAR 15M for 3 programmes)']
    }
  },
  {
    id: 'evamp-tec-dmp-l3', vendorId: 'evamp', title: 'TeC DMP / UIL software maintenance & support (single source, 1 year)',
    businessScope: ['mobile'], domains: ['DMS', 'UIL'],
    sourceDoc: 'Salam Single Source DMS-W.pdf + DMS Technical Proposal ES-Salam-Support&Maintenance-PA1 (ID 4314)', sourcePages: 'Proposal §4.4.5 service credits; §4.1 CR lifecycle; §6 escrow; §8 engagement options',
    effectiveFrom: 'not contracted (SSD 21 Dec 2025)', effectiveTo: '1 year from takeover, early termination when Comviva DMS goes live', status: 'single-source approval stage',
    eligibleMonthlyFeeSar: null, monthlyPenaltyCapPercent: 5, penaltyMode: 'estimate_only',
    penaltyCap: 'Proposal: P1 0.03% of Quarterly Subscription Fee per incident per hour beyond SLA (cap 5%/quarter); P2 0.02% (cap 3%); availability 99.5%/quarter: 99.0-99.49% 2%, 98.0-98.99% 4%, <98% 5%; overall cap 5% of quarterly fee.',
    financials: {
      currency: 'USD', contractValueSar: null, contractValueOther: 'USD 349,000 / year (SSD anticipated budget; commercial proposal not in file set)', term: '1 year',
      monthlyFeeSar: null, monthlyFeeBasis: 'Quarterly subscription fee (credits are % of it) — amount not extracted', oneOffSar: null,
      paymentTerms: 'not found', amendments: [], renewalDue: 'PO expected within 1 week of approval; HOTO weeks 1-4', liabilityCap: 'not found',
      sources: ['SSD Dec 2025', 'Technical proposal 15 Dec 2025']
    }
  }
];

const obligations = [
  /* ---------------- Oracle MS OD (Annex 2 Tables 13-15, Annex 4) */
  { id: 'oracle-ack', vendorId: 'oracle', contractId: 'oracle-ms-od-14253496', category: 'incident_response', title: 'Incident acknowledgement (Remedy ticket -> first Oracle response)',
    appliesTo: { business: ['fixed', 'mobile'], domains: ['BSS', 'OSS', 'Siebel', 'BRM', 'OSM', 'UIM'] },
    target: { P1: '100% within 15 min (24x7)', P2: '99% within 30 min (24x7)', P3: '98% within 1 h (business hours)', P4: '98% within 4 h (business hours)' },
    attainmentTarget: 'P1 100% / P2 99% / P3-P4 98%', weight: { P1: '2% at 98-98.99%, 5% below 98%', P2: '2% below 98%', P3: 'no credit', P4: 'no credit' },
    operatorMessages: { met: 'Oracle acknowledgement within Table 14 target.', warning: 'Oracle acknowledgement close to target; confirm SDM on-call has the Remedy ticket.', breached: 'Oracle acknowledgement missed; log for the monthly SLA report and Steering Committee.' },
    evidencePlan: ['alerts.ack_at - alerts.fired_at for Oracle-owned rules', 'Remedy ticket first-response timestamp', 'Oracle monthly SLA performance report'], phase: 4 },
  { id: 'oracle-restoration', vendorId: 'oracle', contractId: 'oracle-ms-od-14253496', category: 'restoration', title: 'Incident restoration',
    appliesTo: { business: ['fixed', 'mobile'], domains: ['BSS', 'OSS'] },
    target: { P1: '100% within 4 h (24x7)', P2: '100% within 8 h (24x7)', P3: '100% within 2 days (business hours)', P4: '100% within 5 days (business hours)' },
    attainmentTarget: 'measured quarterly per severity', weight: { P1: '5% at 98-98.99%, 10% below 98%', P2: '5% at 98-98.99%, 10% below 98%', P3: '5% below 95%', P4: '5% below 95%' },
    operatorMessages: { met: 'Oracle restoration within target.', warning: 'Oracle restoration approaching target; ask SDM for workaround/ETA and severity confirmation.', breached: 'Oracle restoration breached; request RCA (P1 2 bd / P2 5 bd) and escalate to Steering Committee if repeated.' },
    evidencePlan: ['alerts.resolved_at - alerts.opened_wall', 'Remedy restore timestamp', 'Oracle weekly SLA summary'], phase: 4 },
  { id: 'oracle-resolution', vendorId: 'oracle', contractId: 'oracle-ms-od-14253496', category: 'resolution', title: 'Permanent resolution (non-product bug) and product-bug via MOS',
    appliesTo: { business: ['fixed', 'mobile'], domains: ['BSS', 'OSS'] },
    target: { 'non-bug P1/P2/P3/P4': '10 / 20 / 30 / 45 business days', 'product bug P1/P2/P3/P4': '30 / 60 / 90 / 120 business days' },
    attainmentTarget: 'quality goal > 90% (P1, P2)', weight: 'no credit stated',
    operatorMessages: { met: 'Resolution within Table 14.', warning: 'Resolution ageing; confirm MOS SR and problem ticket.', breached: 'Resolution overdue; add to SR-ageing report and Steering Committee.' },
    evidencePlan: ['problem ticket closed_at - opened_at', 'MOS SR lifecycle', 'quarterly SR-ageing report'], phase: 4 },
  { id: 'oracle-rca', vendorId: 'oracle', contractId: 'oracle-ms-od-14253496', category: 'rca', title: 'RCA for P1/P2',
    appliesTo: { business: ['fixed', 'mobile'], domains: ['BSS', 'OSS'] }, target: { P1: '2 business days', P2: '5 business days' }, attainmentTarget: 'per incident', weight: 'no credit stated',
    operatorMessages: { met: 'RCA delivered on time.', warning: 'RCA due within a day; chase the SDM.', breached: 'RCA overdue; record in governance report.' },
    evidencePlan: ['RCA submitted_at - restoration', 'RCA on Salam template'], phase: 4 },
  { id: 'oracle-availability', vendorId: 'oracle', contractId: 'oracle-ms-od-14253496', category: 'availability', title: 'Application and solution availability (monthly, Sev-1 unplanned outages only)',
    appliesTo: { business: ['fixed', 'mobile'], domains: ['BRM', 'Siebel', 'OSB', 'Integrations'] },
    target: { 'BRM-ECE active-active (charging)': '99.999% (credit 5% below 99.8%; needs Premier Support)', 'BRM, Siebel': '99.5%', 'Solution (apps, infra, integrations) excl. planned': '99.9% — 99.8% warning; 99.8-99.7% Steering; <99.7% 2%; below target 3 periods in 12 months 5%', RPO: '5 min (ECE real-time)', 'DR drill': 'annual, min 3 days' },
    attainmentTarget: 'monthly', weight: '2-5% of monthly fee by band',
    operatorMessages: { met: 'Oracle availability within target.', warning: 'Availability at 99.8% warning band; prepare outage evidence.', breached: 'Availability below 99.7%; credit candidate 2% (5% if third period in 12 months).' },
    evidencePlan: ['P1 outage minutes from alerts (opened_wall/resolved_at)', 'Oracle daily availability report', 'maintenance calendar'], phase: 4 },
  { id: 'oracle-operations', vendorId: 'oracle', contractId: 'oracle-ms-od-14253496', category: 'governance', title: 'Operational KPIs: monitoring alarm-to-ticket, backup, performance, security patching',
    appliesTo: { business: ['fixed', 'mobile'], domains: ['BSS', 'OSS'] },
    target: { 'Alarm -> ticket': 'Critical 100% in 5 min / Major 90% in 10 min / Minor 80% in 30 min (miss 1x warning, 2x Steering, >=3x 2%)', 'Backup success': '99.9% (98% warning; 97% Steering; <96% 2%; 3 cycles 5%)', 'Performance vs agreed throughput': '100% (<1% warning; 1-2% Steering; >2% 2%; 3 periods 5%)', 'Critical security patches': '<= 1 month from scan (1 non-core 0.5%; 2 non-core 1%; >2 non-core 2%; 1 core 5%)', 'Service desk missed contacts': '0 (1-3 warning; >3 Steering + warning letter)' },
    attainmentTarget: 'monthly', weight: '0.5-5% by KPI',
    operatorMessages: { met: 'Operational KPIs within Table 15.', warning: 'An operational KPI is in the warning band.', breached: 'Operational KPI breached; credit candidate per Table 15 band.' },
    evidencePlan: ['alert->ticket latency (console vs Remedy)', 'backup job results', 'patch compliance report', 'Oracle monthly governance report'], phase: 5 },
  { id: 'oracle-change', vendorId: 'oracle', contractId: 'oracle-ms-od-14253496', category: 'change', title: 'Change-request delivery (Exhibit 2 pool)',
    appliesTo: { business: ['fixed', 'mobile'], domains: ['BSS', 'OSS'] },
    target: { 'Standard CR': 'dev 8 working hours, test/deploy 4 h (credit 5% of CR value or 1 MD)', 'Major CR': 'dev 5 working days, test/deploy 2 wd (10% or 2 MD)', 'Emergency CR': 'mutually agreed (10%/2 MD; analysis accuracy 20%/5 MD)', 'On-time': '> 90% monthly', 'Pool': '2,000 PD/yr (forfeited if unused) + 24 ops CR days/month; CR <= 90 PD' },
    attainmentTarget: '> 90% on-time monthly', weight: 'credit per CR',
    operatorMessages: { met: 'CR delivery on time.', warning: 'CR pool consumption or on-time rate needs review.', breached: 'CR SLA missed; credit candidate per CR value.' },
    evidencePlan: ['Capacity Consumption Report (before each invoice)', 'JCR within 10 days', 'CR tracker'], phase: 5 },
  { id: 'oracle-business-kpi', vendorId: 'oracle', contractId: 'oracle-ms-od-14253496', category: 'performance', title: 'Business KPIs (Annex 4, quarterly, after stabilisation of Releases 1-7)',
    appliesTo: { business: ['fixed', 'mobile'], domains: ['Siebel', 'OSM', 'ASAP', 'BRM'] },
    target: { 'E2E new order Siebel->ASAP/IPSA->Siebel': '< 10 min mobile / < 20 min FTTH / < 30 min corporate & wholesale @ 95%', 'Subscriber creation': 'postpaid < 20 s, prepaid < 60 s', 'SIM change / disconnect': '< 20 s', 'Bulk activation': '< 30 min', 'Mediation': '<= 4 h', 'Credit points': '28 cumulative; >5-10 pts 0.5%, >10-15 1%, >15 2% of quarterly invoice' },
    attainmentTarget: '95-99.5% quarterly', weight: '0.5-2% of quarterly invoice',
    operatorMessages: { met: 'Business KPIs within Annex 4.', warning: 'KPI points accumulating this quarter.', breached: 'KPI credit band reached; include in quarterly performance evaluation.' },
    evidencePlan: ['journey rollups (order latency, activation)', 'OSB archive', 'Oracle quarterly KPI report'], phase: 5 },
  { id: 'oracle-edge-milestones', vendorId: 'oracle', contractId: 'oracle-edge-catalyst-19029527', category: 'delivery', title: 'Edge Catalyst milestone delivery (Ex.1 R1/R2, Ex.2 SIP/CUC)',
    appliesTo: { business: ['fixed'], domains: ['B2B migration'] },
    target: { 'Late milestone': '1% of milestone value per week', 'Failed success criteria': '1% of milestone value', Caps: 'SAR 1,575,000 Ex.1 / SAR 420,000 Ex.2', 'Acceptance': '10 business days deemed acceptance', 'Claim (30 Mar 2026)': 'SAR 557,550 — R1 RD.140 +18 wks, R1 DS.140 +14.6, R2 RD.140 +16.2, R2 DS.140 +19.6, R3 RD.140 +9' },
    attainmentTarget: 'per approved plan', weight: '1%/week of milestone value',
    operatorMessages: { met: 'Milestone on plan.', warning: 'Milestone forecast slipping; log the cause (Salam vs Oracle attributable).', breached: 'Milestone late; penalty candidate = weeks late x 1% x milestone value.' },
    evidencePlan: ['PMP / Jira milestone dates', 'RD.140 / DS.140 sign-off records', 'Salam feedback deck 19 May 2026'], phase: 5 },

  /* ---------------- Subex Amendment 1 */
  { id: 'subex-response', vendorId: 'subex', contractId: 'subex-138-2022', category: 'incident_response', title: 'FM application support — mean time to acknowledge',
    appliesTo: { business: ['fixed', 'mobile'], domains: ['Fraud Management', 'HyperSense'] },
    target: { P1: '30 min (24x7)', P2: '30 min (24x7)', P3: '4 h', P4: '5 business days' }, attainmentTarget: 'not stated', weight: 'no penalty',
    operatorMessages: { met: 'Subex acknowledgement within Amendment 1 matrix.', warning: 'Subex acknowledgement near 30 min.', breached: 'Subex acknowledgement missed; record for governance (no contractual credit).' },
    evidencePlan: ['alerts.ack_at for RAFM-owned rules', 'Subex ticket timestamps'], phase: 4 },
  { id: 'subex-restoration', vendorId: 'subex', contractId: 'subex-138-2022', category: 'restoration', title: 'FM application support — mean time to recover / resolve',
    appliesTo: { business: ['fixed', 'mobile'], domains: ['Fraud Management', 'HyperSense'] },
    target: { 'P1 recover / resolve': '4 h / 6 days', 'P2 recover / resolve': '10 h / 10 days', 'P3 recover / resolve': '5 business days / next maintenance release', P4: 'to be determined' }, attainmentTarget: 'not stated', weight: 'no penalty',
    operatorMessages: { met: 'Subex recovery within matrix.', warning: 'Subex recovery approaching target.', breached: 'Subex recovery missed; escalate per §33 representatives ladder.' },
    evidencePlan: ['alerts.resolved_at', 'Subex ticket lifecycle'], phase: 4 },
  { id: 'subex-availability', vendorId: 'subex', contractId: 'subex-138-2022', category: 'availability', title: 'FM application availability (calendar month)',
    appliesTo: { business: ['fixed', 'mobile'], domains: ['Fraud Management'] },
    target: { availability: '99% = 100 - (hours FM completely down / total hours) x 100', exclusions: 'planned downtime; hardware/OS/network/non-Subex causes', 'material breach': '3 consecutive months below 99%' }, attainmentTarget: '99%', weight: '1% of monthly subscription fee per 1% shortfall, cap 10%',
    operatorMessages: { met: 'FM availability >= 99%.', warning: 'FM downtime approaching the 1% monthly budget (~7.3 h).', breached: 'FM availability below 99%; credit candidate 1% per 1% shortfall (cap 10%).' },
    evidencePlan: ['RAFM outage minutes from alerts', 'Subex availability statement'], phase: 4 },
  { id: 'subex-delivery', vendorId: 'subex', contractId: 'subex-138-2022', category: 'delivery', title: 'Milestone delivery and migration assurance accuracy',
    appliesTo: { business: ['fixed', 'mobile'], domains: ['Revenue Assurance', 'Migration assurance'] },
    target: { 'Delay LDs': '1%/week of milestone value, cap 10% (Salam may terminate at cap)', 'Migration assurance': 'Subex-attributable reconciliation failures found within 3 months -> up to 5% of engagement as free CR-bucket credit', 'R5/R6': '10 weeks, 4 dry runs, 124 KPIs' }, attainmentTarget: 'per engagement', weight: 'up to 5% / 10%',
    operatorMessages: { met: 'Deliverables on plan.', warning: 'Migration dry run slipping.', breached: 'Milestone late or reconciliation error attributable to Subex; raise credit candidate.' },
    evidencePlan: ['Go/No-Go reports', 'dry-run observation reports', 'PAC dates'], phase: 5 },

  /* ---------------- Comviva LoA */
  { id: 'comviva-delivery', vendorId: 'comviva', contractId: 'comviva-197-2024', category: 'delivery', title: 'DMS implementation milestones (10 months from WCD)',
    appliesTo: { business: ['fixed', 'mobile'], domains: ['DMS'] },
    target: { Mobilisation: '4 weeks from PO/contract', Completion: '10 months from WCD', Milestones: 'BRSD 15% -> HLD/LLD 15% -> build 25% -> E2E test 15% -> UAT 20% -> handover 10%', Penalty: '1% of milestone amount per week, cap 10% of PO; only Comviva-attributable delay' }, attainmentTarget: 'per project plan Annexure-1', weight: '1%/week',
    operatorMessages: { met: 'Comviva milestone on plan.', warning: 'Milestone forecast slipping; document attribution (Salam approvals expected within 3 days).', breached: 'Milestone late; penalty candidate = weeks x 1% x milestone amount; consider withholding PAC/JCR.' },
    evidencePlan: ['project plan Annexure-1', 'PAC/JCR dates'], phase: 5 },
  { id: 'comviva-support', vendorId: 'comviva', contractId: 'comviva-197-2024', category: 'governance', title: 'Managed service coverage and version support (operational SLA not yet contracted)',
    appliesTo: { business: ['fixed', 'mobile'], domains: ['DMS'] },
    target: { 'L2 managed service': '8x5 remote (years 2-5 priced, year 1 FOC)', 'L4 product support': 'remote, FOC, preventive maintenance', 'Version support': 'implemented version supported 5 years, no forced upgrade', 'Availability / response / resolution': 'NOT FOUND in LoA, BOQ, TER — to be taken from the definitive agreement' }, attainmentTarget: 'to be contracted', weight: 'none',
    operatorMessages: { met: 'Coverage as per LoA.', warning: 'Definitive agreement still missing the operational SLA table.', breached: 'Support outside contracted coverage — escalate to contracting owner.' },
    evidencePlan: ['definitive agreement Annexure-1', 'DMS journey rollups once live'], phase: 5 },

  /* ---------------- Infosys TCoE (Schedule A commercial T&C §4) */
  { id: 'infosys-tcoe-kpis', vendorId: 'infosys', contractId: 'infosys-187-2025', category: 'performance', title: 'TCoE managed-testing SLAs (monthly, per demand/release)',
    appliesTo: { business: ['fixed', 'mobile'], domains: ['Testing', 'Test automation'] },
    target: { 'Test Execution Efficiency': '> 90% (2%)', 'Defect Removal Efficiency **': '> 90% (2%)', 'Test Case Design Completion': '100% (1%)', 'Test Cycle Adherence **': '95% on time (3%)', 'Test Case Coverage': '> 95% (1%)', 'Regression Automation **': '> 80% (4%)', 'Additional breaches': '1% per occurrence', 'Baseline': 'first 3 months; measurement tooling by end of transition else max monthly penalty' },
    attainmentTarget: 'monthly', weight: 'weightages sum 13%, cap 10%/month; ** = termination trigger after 3 consecutive months',
    operatorMessages: { met: 'TCoE SLAs within target.', warning: 'A ** SLA missed this month — second consecutive miss triggers termination watch.', breached: 'TCoE SLA missed; credit candidate = weightage; log in monthly Program Review.' },
    evidencePlan: ['qTest execution and defect data', 'monthly KPI/SLA report', 'quarterly man-day reconciliation'], phase: 5 },
  { id: 'infosys-tcoe-transition', vendorId: 'infosys', contractId: 'infosys-187-2025', category: 'governance', title: 'Transition, resourcing and reporting',
    appliesTo: { business: ['fixed', 'mobile'], domains: ['Testing'] },
    target: { Transition: '8 weeks; schedule deviation 0%, RKT 100%, KT rating >= 3/5, >= 1 doc per app (weekly)', Baseline: '315 man-days/month, reducible 20% with next-month delta', Replacement: 'absence > 2 weeks replaced with equal qualification', Reports: 'daily status (non-agile), monthly KPI/SLA at Program Review, quarterly at Strategic Review', 'Delay penalty': '1% of Contract Price per week, cap 10%' },
    attainmentTarget: 'per transition plan', weight: 'delay 1%/week',
    operatorMessages: { met: 'Transition and staffing on plan.', warning: 'Staffing below baseline or KT rating low.', breached: 'Transition milestone late or resource gap; raise in Program Review.' },
    evidencePlan: ['transition tracker', 'resource roster', 'JCR'], phase: 5 },
  { id: 'infosys-rimal-golive', vendorId: 'infosys', contractId: 'infosys-214-2025', category: 'delivery', title: 'Rimal DC Apollo upgrade milestones and go-live clawback',
    appliesTo: { business: ['fixed', 'mobile'], domains: ['BSS', 'OSS', 'Rimal DC'] },
    target: { Mobilisation: '8 weeks from LoA', Duration: '7 months upgrade + 3 months hypercare', 'Go-live (M7, 25%)': 'missed -> Salam may recover all M1-M6 payments (up to SAR 4,180,688)', 'Delay': '1% of PO per week, cap 10%', Warranty: '3 months hypercare for upgrade-caused defects only' }, attainmentTarget: 'per plan', weight: '1%/week; clawback 55%',
    operatorMessages: { met: 'Upgrade milestone on plan.', warning: 'Mock run / UAT slipping; go-live clawback exposure.', breached: 'Milestone late; penalty candidate and clawback review.' },
    evidencePlan: ['milestone acceptance records', 'monthly Steering Committee minutes'], phase: 5 },

  /* ---------------- Evamp & Saanga proposal */
  { id: 'evamp-availability', vendorId: 'evamp', contractId: 'evamp-tec-dmp-l3', category: 'availability', title: 'TeC DMP system availability (calendar quarter)',
    appliesTo: { business: ['mobile'], domains: ['DMS', 'UIL'] },
    target: { availability: '99.5% = (quarter minutes - outage minutes) / quarter minutes', credits: '99.0-99.49% 2%; 98.0-98.99% 4%; < 98% 5% of Quarterly Subscription Fee (overall cap 5%)', exclusions: 'planned maintenance, force majeure, Salam/3rd-party faults, regulatory; same root cause within 24 h = one incident' }, attainmentTarget: '99.5%', weight: '2-5% of quarterly fee',
    operatorMessages: { met: 'DMS availability >= 99.5%.', warning: 'DMS outage minutes approaching the quarterly budget (~11 h).', breached: 'DMS availability below 99.5%; credit candidate per band.' },
    evidencePlan: ['DMS journey rollups (dms.js)', 'alerts outage minutes for DMS rules'], phase: 4 },
  { id: 'evamp-resolution', vendorId: 'evamp', contractId: 'evamp-tec-dmp-l3', category: 'resolution', title: 'Incident resolution beyond agreed SLA (P1/P2)',
    appliesTo: { business: ['mobile'], domains: ['DMS', 'UIL'] },
    target: { P1: 'complete outage / security breach / >= 10% throughput loss — 24/7 continuous effort; 0.03% of quarterly fee per incident per hour beyond SLA (cap 5%)', P2: '8-<10% throughput or 1-<8% functional loss — accelerated; 0.02% per incident per hour (cap 3%)', P3: 'standard releases; > 3 recurrences/quarter -> reclassified P2', 'Resolution hours': 'SLA table is an image in the proposal — not extracted' }, attainmentTarget: 'per incident', weight: '0.02-0.03% per incident-hour',
    operatorMessages: { met: 'DMS incident resolved within SLA.', warning: 'P1/P2 resolution clock running.', breached: 'Resolution beyond SLA; credit candidate = hours x rate x quarterly fee.' },
    evidencePlan: ['alerts opened/resolved for DMS rules', 'E&S weekly progress report'], phase: 4 },
  { id: 'evamp-cr-escrow', vendorId: 'evamp', contractId: 'evamp-tec-dmp-l3', category: 'governance', title: 'CR lifecycle, escrow and exit',
    appliesTo: { business: ['mobile'], domains: ['DMS'] },
    target: { 'CR acknowledge': '1-2 working days', 'Scoping / solution doc / estimate / dev / delivery': '5-8 / 7-9 / 3-5 / 10-20 / 2-4 working days', Escrow: 'deposit within 30 days of signature; refresh each major release or 6 months', 'Quality gate': 'build fails < 95% unit-test coverage or critical vulnerabilities', Exit: 'dual run -> shared -> successor run -> closure' }, attainmentTarget: 'per proposal', weight: 'none',
    operatorMessages: { met: 'CR and escrow obligations on track.', warning: 'Escrow refresh or CR acknowledgement overdue.', breached: 'Governance obligation missed; raise at monthly Management Review.' },
    evidencePlan: ['Redmine/JIRA CR tracker', 'escrow deposit receipts'], phase: 5 }
];

const assignments = [
  { id: 'bss-oss-oracle', vendorId: 'oracle', business: 'both', domains: ['BSS', 'OSS', 'Siebel', 'BRM', 'OSM', 'OSB'], journeys: ['order to activation (Apollo)', 'billing & charging', 'B2B migration (Edge Catalyst)', 'MVNO B2C charging'], consoleSurfaces: ['Executive brief vendor block', 'Monitoring/OSB', 'Alerts', 'SLA page', 'monthly governance pack'] },
  { id: 'rafm-subex', vendorId: 'subex', business: 'both', domains: ['Revenue Assurance', 'Fraud Management'], journeys: ['RA controls', 'fraud detection', 'billing migration assurance'], consoleSurfaces: ['Alerts (RAFM rules)', 'SLA page', 'monthly governance pack'] },
  { id: 'dms-comviva', vendorId: 'comviva', business: 'both', domains: ['DMS', 'Commission'], journeys: ['dealer activation', 'commission run', 'indirect sales'], consoleSurfaces: ['DMS page', 'Fixed SDA map (post migration)', 'SLA page'] },
  { id: 'testing-infosys', vendorId: 'infosys', business: 'both', domains: ['Testing', 'DevSecOps'], journeys: ['release testing', 'regression automation', 'Apollo upgrade'], consoleSurfaces: ['Change & release calendar', 'monthly governance pack'] },
  { id: 'dms-evamp', vendorId: 'evamp', business: 'mobile', domains: ['DMS', 'UIL'], journeys: ['dealer activation (MVNO)', 'dealer app'], consoleSurfaces: ['DMS page', 'Alerts', 'SLA page'] }
];

const escalationFlows = [
  { id: 'oracle-ms-escalation', vendorId: 'oracle', contractId: 'oracle-ms-od-14253496', title: 'Oracle managed-services SLA escalation', enabled: true, mode: 'reference', ownerGroup: 'Oracle Service Delivery Manager',
    description: 'Reminder ladder aligned to Table 14 acknowledgement clocks (P1 15 min, P2 30 min); management copied for P1/P2; repeated misses feed the monthly Steering Committee warning-letter process.',
    channels: { mail: true, teams: false, whatsapp: false, managementMail: true }, managementRecipients: [], defaultPolicy: clone(ORACLE_POLICY),
    items: [item('oracle-ack', ORACLE_POLICY, 'Acknowledgement clock at risk; confirm Remedy ticket reached Oracle SDM/on-call.'), item('oracle-restoration', ORACLE_POLICY, 'Restoration at risk; request workaround, ETA and severity confirmation; prepare RCA request.'), item('oracle-availability', ORACLE_POLICY, 'Availability band reached; collect Sev-1 outage minutes and planned-maintenance exclusions.'), item('oracle-rca', ORACLE_POLICY, 'RCA due (P1 2 bd / P2 5 bd); chase SDM.'), item('oracle-edge-milestones', GENERIC_POLICY, 'Edge Catalyst milestone slipping; log attribution evidence for the penalty file.')] },
  { id: 'subex-escalation', vendorId: 'subex', contractId: 'subex-138-2022', title: 'Subex RAFM SLA escalation', enabled: true, mode: 'reference', ownerGroup: 'Subex support (Haytham Rabie, Sales Director — notices)',
    description: 'Ladder on the Amendment 1 MTTA/MTTR matrix (P1/P2 acknowledge 30 min, recover 4 h / 10 h). Contractual escalation is the §33 representatives ladder; availability is the only credit-bearing item.',
    channels: { mail: true, teams: false, whatsapp: false, managementMail: true }, managementRecipients: [], defaultPolicy: clone(SUBEX_POLICY),
    items: [item('subex-response', SUBEX_POLICY, 'Subex acknowledgement clock at risk.'), item('subex-restoration', SUBEX_POLICY, 'Subex recovery clock at risk; confirm L3 24x7 engagement for P1/P2.'), item('subex-availability', SUBEX_POLICY, 'FM availability budget at risk; collect downtime evidence and exclusions.')] },
  { id: 'comviva-escalation', vendorId: 'comviva', contractId: 'comviva-197-2024', title: 'Comviva DMS delivery escalation', enabled: false, mode: 'reference', ownerGroup: 'Comviva project manager (definitive agreement pending)',
    description: 'Delivery-phase only until the definitive agreement supplies operational SLAs; disabled by default.',
    channels: { mail: true, teams: false, whatsapp: false, managementMail: true }, managementRecipients: [], defaultPolicy: clone(GENERIC_POLICY),
    items: [item('comviva-delivery', GENERIC_POLICY, 'Milestone slipping; document attribution and PAC/JCR position.')] },
  { id: 'infosys-escalation', vendorId: 'infosys', contractId: 'infosys-187-2025', title: 'Infosys TCoE SLA escalation', enabled: true, mode: 'reference', ownerGroup: 'Infosys TCoE Program Manager / Client Partner',
    description: 'Monthly SLA items — reminders are governance follow-ups (Program Review), not incident clocks.',
    channels: { mail: true, teams: false, whatsapp: false, managementMail: true }, managementRecipients: [], defaultPolicy: clone(GENERIC_POLICY),
    items: [item('infosys-tcoe-kpis', GENERIC_POLICY, 'TCoE SLA missed; second consecutive miss on a ** SLA starts the termination watch.'), item('infosys-rimal-golive', GENERIC_POLICY, 'Rimal go-live at risk; review clawback exposure.')] },
  { id: 'evamp-escalation', vendorId: 'evamp', contractId: 'evamp-tec-dmp-l3', title: 'Evamp & Saanga DMS L3 escalation', enabled: false, mode: 'reference', ownerGroup: 'E&S L3 Ops -> Project Director -> VP Operations',
    description: 'From the proposal escalation path; disabled until the subscription is contracted.',
    channels: { mail: true, teams: false, whatsapp: false, managementMail: true }, managementRecipients: [], defaultPolicy: clone(GENERIC_POLICY),
    items: [item('evamp-resolution', GENERIC_POLICY, 'P1/P2 resolution clock running beyond SLA; credit accrues per hour.'), item('evamp-availability', GENERIC_POLICY, 'DMS availability budget at risk this quarter.')] }
];

const evidenceMappings = [
  ev('ev-oracle-ack', 'oracle-ack', ['ack_sla', 'alerts', 'itsm'], 'ack_sla', 'acknowledgement_minutes', 'alerts.ack_at - alerts.fired_at for Oracle-assigned rules; Remedy first-response once connected', 'Alerts / ACK SLA / SLA dashboard', 'live', 'exact for console alerts; contractual clock is the Remedy ticket', ['Oracle-owned rules must carry team = Oracle'], 'Import Remedy first-response timestamps'),
  ev('ev-oracle-restoration', 'oracle-restoration', ['alerts', 'itsm'], 'alerts', 'restoration_minutes', 'alerts.resolved_at - alerts.opened_wall; quarterly attainment per severity', 'Alerts / SLA dashboard / monthly governance pack', 'live', 'exact for console incidents', ['Only Sev-1/Sev-2 with 24x7 clock; P3/P4 business hours'], 'Validate against Oracle weekly SLA summary'),
  ev('ev-oracle-availability', 'oracle-availability', ['alerts', 'vendor_reports'], 'alerts', 'availability_error_budget', 'P1 unplanned outage minutes per production environment vs monthly minutes; planned windows excluded', 'SLA dashboard / Executive brief', 'partial', 'probable — outage boundaries from alerts, planned windows manual', ['Maintenance calendar must be maintained'], 'Ingest Oracle daily availability report'),
  ev('ev-oracle-business-kpi', 'oracle-business-kpi', ['rollups', 'osb_archive'], 'rollups', 'journey_success_latency', 'order-to-activation latency and subscriber creation timings from journey rollups', 'Monitoring / SLA dashboard', 'partial', 'exact for measured journeys', ['Annex 4 applies only after release stabilisation'], 'Map Annex 4 KPIs to rollup keys'),
  ev('ev-oracle-edge', 'oracle-edge-milestones', ['vendor_reports'], 'vendor_reports', 'milestone_delay_weeks', 'baseline vs actual milestone dates from PMP/Jira', 'Monthly governance pack / Executive brief', 'planned', 'manual', ['Attribution must be recorded per milestone'], 'Track milestones in the console programme register'),
  ev('ev-subex-availability', 'subex-availability', ['alerts', 'vendor_reports'], 'alerts', 'availability_error_budget', 'RAFM outage hours from alerts vs calendar-month hours; exclusions per Amendment 1 §3', 'SLA dashboard', 'partial', 'probable', ['Define which console rules represent FM "completely down"'], 'Add RAFM availability probe'),
  ev('ev-subex-response', 'subex-response', ['ack_sla', 'alerts'], 'ack_sla', 'acknowledgement_minutes', 'alerts.ack_at - alerts.fired_at for RAFM rules', 'Alerts', 'live', 'exact for console alerts', [], 'Link Subex ticket ids to alerts'),
  ev('ev-comviva-delivery', 'comviva-delivery', ['vendor_reports'], 'vendor_reports', 'milestone_delay_weeks', 'project plan vs PAC/JCR dates', 'Monthly governance pack', 'planned', 'manual', ['Definitive agreement pending'], 'Register milestones when the agreement is signed'),
  ev('ev-infosys-kpis', 'infosys-tcoe-kpis', ['vendor_reports'], 'vendor_reports', 'test_kpi_attainment', 'qTest/Tosca metrics and monthly KPI report', 'Monthly governance pack', 'planned', 'manual until qTest export is wired', ['Baseline agreed in first 3 months'], 'Import monthly KPI report'),
  ev('ev-evamp-availability', 'evamp-availability', ['rollups', 'alerts'], 'rollups', 'availability_error_budget', 'DMS journey rollups and DMS-rule outage minutes per quarter', 'DMS page / SLA dashboard', 'partial', 'probable', ['Not contracted yet'], 'Confirm quarterly fee for credit base')
];

const penaltyRules = [
  pen('pen-oracle-ack', 'oracle', 'oracle-ms-od-14253496', 'oracle-ack', { monthlyCapPercent: 10, severityWeights: { P1: 5, P2: 2, P3: 0, P4: 0 }, weightPercent: null, calculationMethod: 'attainment_band_x_monthly_fee', capBasis: 'Table 14 bands: P1 2% at 98-98.99% / 5% below 98%; P2 2% below 98%. Monthly cap 10% of monthly fee; aggregate 10% of order.', notes: 'Applies from 90 days after first go-live / end of transition.' }),
  pen('pen-oracle-restoration', 'oracle', 'oracle-ms-od-14253496', 'oracle-restoration', { monthlyCapPercent: 10, severityWeights: { P1: 10, P2: 10, P3: 5, P4: 5 }, calculationMethod: 'attainment_band_x_monthly_fee', capBasis: 'P1/P2 5% at 98-98.99%, 10% below 98%; P3/P4 5% below 95%. Highest credit only per shared root cause.' }),
  pen('pen-oracle-availability', 'oracle', 'oracle-ms-od-14253496', 'oracle-availability', { monthlyCapPercent: 10, weightPercent: null, calculationMethod: 'availability_band_x_monthly_fee', capBasis: 'Solution <99.7% 2%, third period in 12 months 5%; BRM-ECE <99.8% 5%.' }),
  pen('pen-oracle-operations', 'oracle', 'oracle-ms-od-14253496', 'oracle-operations', { monthlyCapPercent: 10, weightPercent: null, calculationMethod: 'kpi_band_x_monthly_fee', capBasis: 'Table 15 bands 0.5-5%.' }),
  pen('pen-oracle-business-kpi', 'oracle', 'oracle-ms-od-14253496', 'oracle-business-kpi', { monthlyCapPercent: 10, weightPercent: null, calculationMethod: 'credit_points_x_quarterly_invoice', capBasis: 'Annex 4: >5-10 pts 0.5%, >10-15 1%, >15 2% of quarterly invoice.' }),
  pen('pen-oracle-edge', 'oracle', 'oracle-edge-catalyst-19029527', 'oracle-edge-milestones', { weightPercent: 1, calculationMethod: 'weeks_late_x_1pct_x_milestone_value', eligibleFeeBasis: 'Milestone value (Ex.1 787,500 typical; Ex.2 420,000 RD/DS)', capBasis: 'SAR 1,575,000 (Ex.1) / SAR 420,000 (Ex.2); sole remedy.', notes: 'Live claim SAR 557,550 (30 Mar 2026), rejected by Oracle 16 Apr 2026.' }),
  pen('pen-subex-availability', 'subex', 'subex-138-2022', 'subex-availability', { monthlyCapPercent: 10, weightPercent: 1, calculationMethod: 'pct_shortfall_x_1pct_x_monthly_subscription_fee', eligibleFeeBasis: 'Monthly subscription fee (undefined in the amendment — licence 31,344.95 vs MS ~113,347; validate)', capBasis: '10% of the monthly subscription fee; credits against future payments only.' }),
  pen('pen-subex-delivery', 'subex', 'subex-138-2022', 'subex-delivery', { weightPercent: 1, calculationMethod: 'weeks_late_x_1pct_x_milestone_value', eligibleFeeBasis: 'Delayed milestone value', capBasis: '10% of milestone value; migration assurance up to 5% of engagement as CR credit.' }),
  pen('pen-comviva-delivery', 'comviva', 'comviva-197-2024', 'comviva-delivery', { weightPercent: 1, calculationMethod: 'weeks_late_x_1pct_x_milestone_amount', eligibleFeeBasis: 'Payment-milestone amount (e.g. UAT 419,525.60)', capBasis: '10% of PO amount.' }),
  pen('pen-infosys-kpis', 'infosys', 'infosys-187-2025', 'infosys-tcoe-kpis', { monthlyCapPercent: 10, weightPercent: null, calculationMethod: 'sla_weightage_x_monthly_fee', capBasis: 'Weightages 2/2/1/3/1/4% (sum 13%), cap 10% per month; +1% per additional breach.' }),
  pen('pen-infosys-delay', 'infosys', 'infosys-187-2025', 'infosys-tcoe-transition', { weightPercent: 1, calculationMethod: 'weeks_late_x_1pct_x_contract_price', eligibleFeeBasis: 'Contract Price SAR 10,480,527', capBasis: '10% of Contract Price.' }),
  pen('pen-infosys-rimal', 'infosys', 'infosys-214-2025', 'infosys-rimal-golive', { weightPercent: 1, calculationMethod: 'weeks_late_x_1pct_x_po_amount', eligibleFeeBasis: 'PO amount SAR 7,601,251', capBasis: '10% of PO; go-live miss -> clawback of M1-M6 (up to SAR 4,180,688).' }),
  pen('pen-evamp-availability', 'evamp', 'evamp-tec-dmp-l3', 'evamp-availability', { monthlyCapPercent: 5, weightPercent: null, calculationMethod: 'availability_band_x_quarterly_fee', eligibleFeeBasis: 'Quarterly Subscription Fee (not extracted)', capBasis: '2/4/5% bands; overall 5% of quarterly fee.' }),
  pen('pen-evamp-resolution', 'evamp', 'evamp-tec-dmp-l3', 'evamp-resolution', { monthlyCapPercent: 5, weightPercent: null, calculationMethod: 'hours_beyond_sla_x_rate_x_quarterly_fee', capBasis: 'P1 0.03%/incident/hour cap 5%; P2 0.02% cap 3%.' })
];

const NEW_VENDOR_IDS = vendors.map(v => v.id);

/* merge into DEFAULT_CONFIG by id (idempotent) and widen the rollout surfaces to the new vendors */
function applyExt(cfg) {
  const add = (list, items) => { const have = new Set(list.map(x => x.id)); items.forEach(x => { if (!have.has(x.id)) list.push(x); }); };
  add(cfg.vendors, vendors); add(cfg.contracts, contracts); add(cfg.obligations, obligations); add(cfg.assignments, assignments);
  add(cfg.escalationFlows, escalationFlows); add(cfg.evidenceMappings, evidenceMappings); add(cfg.penaltyRules, penaltyRules);
  for (const s of cfg.rolloutSurfaces || []) {
    if (['rollout-sla-dashboard', 'rollout-incident-details', 'rollout-monthly-pack', 'rollout-mail-preview'].includes(s.id)) {
      s.vendors = [...new Set([...(s.vendors || []), ...NEW_VENDOR_IDS])];
    }
  }
  return cfg;
}

module.exports = { applyExt, vendors, contracts, obligations, assignments, escalationFlows, evidenceMappings, penaltyRules, NEW_VENDOR_IDS };
