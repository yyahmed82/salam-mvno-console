/* opsProjectsSeed.js — first content of Operations Projects (VP Operations ▾ › Operations Projects, 10 Oct 2026, alpha.175)
 *
 * Two projects, written from the documents Yosri pointed to:
 *   IBM Instana (SBM · IBM)  "Instana Project History & Recovery Safeguards" (8 Oct 2026, 21 mail threads May 2024 – Oct 2026,
 *                            BRD v1.3 and V2.0) + SBM's mail "Salam - Instana || Requirements Discussion" (1–7 Oct 2026:
 *                            MoM of the 30 Sep demo, domain status, training agenda).
 *   BSS migration R5/R6      the "R5/R6_Ops Readiness_Weekly Alignment with IT Ops and Oracle MS" thread (Aug – 8 Oct 2026, with
 *   (Oracle · IMPACT)        the PAT-scope and IWC-statistics threads), the cutover-strategy MoM (EY, 2 Sep 2026) with Oracle's
 *                            runbook v0.03, the FTTH impact tracker (17 Sep 2026) and the Arqami SIT evidence (Jun 2026).
 * Rules: names and roles only — no e-mail addresses or phone numbers; no customer data; the team is "IT Operations".
 * Every row has a seed_key: a row someone deletes is never brought back, a later VERSION only adds the keys it lacks. */
'use strict';

const VERSION = 1;

/* ------------------------------------------------------------------ helpers (keep the rows readable) */
const ms = (key, title, date, status, x) => Object.assign({ key, kind: 'milestone', title, date, status }, x || {});
const ev = (key, date, topic, title, tone, body) => ({ key, kind: 'event', date, title, body: body || null, data: { topic, tone: tone || 'neutral' } });
const ws = (key, title, pct, status, x) => Object.assign({ key, kind: 'workstream', title, pct, status }, x || {});
const bn = (key, title, severity, x) => Object.assign({ key, kind: 'bottleneck', title, severity, status: 'open' }, x || {});
const gp = (key, title, severity, x) => Object.assign({ key, kind: 'gap', title, severity, status: 'open' }, x || {});
const rq = (key, title, status, x) => Object.assign({ key, kind: 'requirement', title, status }, x || {});
const ac = (key, title, owner, due, status, x) => Object.assign({ key, kind: 'action', title, owner, due, status }, x || {});
const dc = (key, title, owner, x) => Object.assign({ key, kind: 'decision', title, owner, status: 'needed' }, x || {});
const cd = (key, title, body, owner, x) => Object.assign({ key, kind: 'condition', title, body, owner, status: 'proposed' }, x || {});
const es = (key, side, level, name, role, when, x) => Object.assign({ key, kind: 'escalation', title: name, data: { side, level, role, when } }, x || {});
const bl = (key, title, amount, status, date, body) => ({ key, kind: 'budget_line', title, amount, status, date, body });
const up = (key, date, rag, title, body) => ({ key, kind: 'update', date, title, body, data: { rag } });

/* ================================================================== 1 · IBM Instana */
const INSTANA = {
  key: 'instana',
  project: {
    slug: 'instana', name: 'IBM Instana observability', code: 'INSTANA',
    vendor: 'SBM · IBM', vendor_detail: 'Saudi Business Machines (SBM) — IBM Systems & Software Solutions; product: IBM Instana',
    program: 'Enterprise observability', segment: 'both', category: 'Observability · APM',
    sponsor: 'Eng. Ali T Atiah — VP Operations',
    owner: 'Yosri A Yahmed — Salam point of contact (named 6 Oct 2026)',
    vendor_pm: 'Osama Eltaweel — Senior Project Manager, SBM',
    status: 'recovery', rag: 'red', phase: 'Restart — third baseline to agree; kickoff workshop to schedule',
    progress: 92, progress_verified: false,
    progress_basis: 'Vendor-reported (SBM, 7 Oct 2026): 6 of 9 domains at 100 %, vCenter 95 %, Apollo 85 %, Digital 50 %. Not accepted by Salam: Impact and FTTH B2C were closed without acceptance evidence.',
    start_date: '2024-05-20', baseline_end: '2025-11-30', end_date: '2026-12-31', baseline_no: 3, go_live: null,
    brief: 'After 29 months the infrastructure domains are largely in place, but the business-observability outcome Salam bought is still not usable. The same dispute has run since mid-2024: what "business monitoring" means in an APM tool, and who builds the data that feeds it.\n\nThe project froze after the November 2025 escalation and restarted on 30 Sep 2026 with a demo at SBM. SBM now reports 6 of 9 domains complete. The roadmap starts once the two held invoices (SAR 856,256 excl. VAT) are settled, on a third baseline both sides aim to finish before the end of 2026.',
    objective: 'Observability across Salam\'s domains — infrastructure, applications and the digital journeys — with dashboards, alerts, synthetic checks and ITSM integration that L1 and L2 use every day, accepted domain by domain with evidence.',
    scope: 'Nine domains: Remedy · GIS · Impact · FTTH B2C · FTTH OSS · Nutanix · vCenter · Apollo · Digital (DMS, MVNO, web and app).\nRemaining per SBM (7 Oct 2026): vCenter connectivity and custom dashboards; Apollo backend, business alerts and dashboards; Digital production deployment (DMS tested on staging; MVNO custom code).\nThen: training (3 days — L1, L2, administrators), LLD and final documentation, one month of support.\nNew since the freeze, outside the original contract: ServiceNow integration; IBM Concert (estimate requested by the CIO).',
    health: {
      schedule: { rag: 'red', note: 'The second baseline ended in Nov 2025 and was missed. The schedule-extension CR SBM says was agreed on 29 Apr 2025 was never issued. A third baseline is being planned; no end date should be committed before the dependency register is agreed.' },
      scope: { rag: 'red', note: 'The BRD was never signed (accepted by e-mail, "final" by deemed acceptance on 26 May 2025). V2.0 narrowed scope without a change log. Business KPIs, log search and SQL content are contested — SBM: "Instana is an APM tool".' },
      budget: { rag: 'amber', note: 'SAR 856,256 excl. VAT on hold: UAT2 acceptance SAR 383,567 (invoiced 9 Nov 2025) and licence renewal SAR 472,689 (invoiced 6 Jan 2026). The contract value is not in the documents provided.' },
      resources: { rag: 'amber', note: 'No named Salam SPOC per domain with time allocated. SBM worked remotely except January 2025, the one period cited as real progress.' },
      quality: { rag: 'red', label: 'Acceptance', note: 'Impact closed at 48 VMs (under 25 %) by meeting agreement; FTTH B2C set to close "if no update". No business dashboard accepted 15 months after the request; alerts never validated by L2.' },
      vendor: { rag: 'amber', note: 'SBM cites late Salam prerequisites (~8 months), sessions Salam moved or missed and CRs Salam owes. A steering existed by Oct 2025 but recorded no decisions.' }
    },
    budget: { currency: 'SAR', total: null, vat: 'excl. VAT',
      note: 'Contract value and payment history are not in the documents provided — to add from Procurement / Finance. SBM also lists an invoice of 13 Feb 2025 as unpaid (Dec 2025).' },
    facts: [
      { label: 'Since the HLD', value: '29 months', note: 'HLD issued 20 May 2024' },
      { label: 'Domains complete', value: '6 / 9', note: 'vendor-reported · vCenter 95 %, Apollo 85 %, Digital 50 %', tone: 'warn' },
      { label: 'Money on hold', value: 'SAR 856,256', note: 'two invoices, excl. VAT', tone: 'bad' },
      { label: 'Baseline', value: '3rd', note: '1st approved 8 Aug 2024 · 2nd missed (Nov 2025)', tone: 'bad' },
      { label: 'Target', value: 'End 2026', note: 'roadmap starts once the payment is settled (30 Sep MoM)' },
      { label: 'Escalation point', value: 'changed 3×', note: 'Dr Ahmed Adel (2024) → Mamoun Abu Salah (2025) → CIO (Dec 2025) → Ehab & Eng. Ali T Atiah (2026)' }
    ],
    accent: '#2563eb', sort: 10
  },
  items: [
    /* ---- domains (workstreams) ---- */
    ws('d-remedy', 'Remedy', 100, 'done', { sort: 1, data: { evidence: 'vendor-reported' }, body: 'Auto-ticketing integration with the API Remedy shared. Open question for the restart: is the ITSM target still Remedy, or ServiceNow (new scope)?' }),
    ws('d-gis', 'GIS', 100, 'done', { sort: 2, data: { evidence: 'vendor-reported' } }),
    ws('d-impact', 'Impact (Oracle IMPACT)', 100, 'disputed', { sort: 3, data: { evidence: 'disputed', remaining: 'Reopen for verification: VM count, dashboards, sign-off.' },
      body: 'Recorded by SBM as closed by meeting agreement on 1 Jul 2025 with 48 VMs installed (under 25 %) and "no further agents". The BRD section on IMPACT (L1/L2 dashboards, orders and failed orders, threshold alerts, e-mail + SMS, auto-ticketing) carries no SBM remark — Salam\'s strongest claim.' }),
    ws('d-ftthb2c', 'FTTH B2C', 100, 'disputed', { sort: 4, data: { evidence: 'disputed', remaining: 'Reopen for verification.' }, body: 'Set to close "if no update" by 20 Aug 2025 — closed without acceptance evidence.' }),
    ws('d-ftthoss', 'FTTH OSS', 100, 'done', { sort: 5, data: { evidence: 'vendor-reported' } }),
    ws('d-nutanix', 'Nutanix', 100, 'done', { sort: 6, data: { evidence: 'vendor-reported' } }),
    ws('d-vcenter', 'vCenter', 95, 'in_progress', { sort: 7, owner: 'Salam SOC / NOC', data: { evidence: 'vendor-reported', remaining: 'Fix the connectivity issue (Salam SOC / NOC) so all 4 vCenters show in Instana. Custom dashboards: requirements and configuration.' } }),
    ws('d-apollo', 'Apollo', 85, 'in_progress', { sort: 8, owner: 'Apollo SPOC (Salam)', data: { evidence: 'vendor-reported', remaining: 'Salam SPOC to say which applications to integrate (in sequence, as Salam asked). Complete the backend configuration, the business alerts and dashboards.' },
      body: 'Listed as closed in the sign-off tracker, but the BRD has no Apollo section. Apollo sent a 900-page HLD in Aug 2025.' }),
    ws('d-digital', 'Digital (DMS · MVNO · web & app)', 50, 'at_risk', { sort: 9, owner: 'IT Operations (Digital) with SBM', data: { evidence: 'vendor-reported', remaining: 'Production deployment, replicating what was done on staging. DMS: production deployment (testing completed on staging). MVNO: the same custom-code solution.' },
      body: 'Sep 2025 alert demo: HTTP 200 with business code 14 ("transition not allowed") was not detected; API error-code monitoring and alert e-mails were not implemented.' }),

    /* ---- milestones ---- */
    ms('m-hld', 'HLD issued by SBM', '2024-05-20', 'done', { done_at: '2024-05-20', sort: 1 }),
    ms('m-rb1', 'First rebaseline approved', '2024-08-08', 'done', { done_at: '2024-08-08', sort: 2, body: 'Approved "for the sake of the program"; the HLD was called "very very high level". SBM: all requirements "will be documented in the BRD".' }),
    ms('m-brd2', 'BRD V2.0 declared final (deemed acceptance)', '2025-05-26', 'done', { done_at: '2025-05-26', sort: 3, body: 'No signatures — the sign-off table is blank in both versions.' }),
    ms('m-b2', 'Second baseline end', '2025-11-30', 'missed', { sort: 4, data: { gate: true }, body: 'Missed; the escalation and the freeze followed.' }),
    ms('m-restart', 'Restart — demo at SBM HQ', '2026-09-30', 'done', { done_at: '2026-09-30', sort: 5 }),
    ms('m-poc', 'Final approved BRD shared · Salam point of contact named', '2026-10-06', 'done', { done_at: '2026-10-06', sort: 6 }),
    ms('m-workshop', 'Kickoff — requirements workshop (Salam · SBM · IBM)', null, 'planned', { sort: 7, data: { gate: true },
      body: 'Agenda: status against the agreed scope per area; architecture changes made during the freeze (e.g. ServiceNow); other requirements. SBM offered Thursday or Sunday slots (7 Oct).' }),
    ms('m-gap', 'Gap analysis to the CIO — in scope vs out of scope, IBM confirmation', null, 'planned', { sort: 8 }),
    ms('m-pay', 'Two held invoices settled (Finance)', null, 'planned', { sort: 9, data: { gate: true }, body: 'Per the 30 Sep MoM the roadmap starts once the payment is settled.' }),
    ms('m-b3', 'Third baseline signed — with the safeguards', null, 'planned', { sort: 10, data: { gate: true } }),
    ms('m-train', 'Training — 3 days (L1, L2, administrators)', null, 'planned', { sort: 11 }),
    ms('m-digital', 'Digital in production (DMS, then MVNO)', null, 'planned', { sort: 12, data: { gate: true } }),
    ms('m-docs', 'LLD and final documentation', null, 'planned', { sort: 13 }),
    ms('m-support', 'One month of support → PAC / FAC', null, 'planned', { sort: 14 }),
    ms('m-end', 'Project complete (target)', '2026-12-31', 'planned', { sort: 15, data: { gate: true }, body: 'Both sides aim to complete before the end of 2026 (30 Sep MoM).' }),

    /* ---- the story so far (oldest first) ---- */
    ev('e-01', '2024-05-20', 'Design', 'SBM issues the HLD', 'neutral'),
    ev('e-02', '2024-05-25', 'Design', 'Salam Infra asks for a POC environment, Remedy integration, app-monitoring use cases, a services SOW, multi-DC, HA, DR and sizing', 'neutral'),
    ev('e-03', '2024-05-27', 'Design', 'PMO: the HLD cannot close without Cybersecurity approval', 'warn'),
    ev('e-04', '2024-06-04', 'Design', 'Salam rejects the HLD — "any delay in timelines is SBM responsibility"', 'bad', 'SBM replies it has chased comments since 20 May; Kubernetes vs OpenShift still undecided.'),
    ev('e-05', '2024-08-05', 'Plan', 'Revised plan: Sprint 1 = Impact, Digital, Apollo (QA then Prod); Sprint 2 = legacy', 'neutral', 'UAT on QA, Prod sanity only; QA prerequisites by 14 Aug, Prod by mid-Sep.'),
    ev('e-06', '2024-08-08', 'Plan', 'First rebaseline approved "for the sake of the program"', 'good'),
    ev('e-07', '2024-08-15', 'BRD', 'BRD v1.3 circulated; the 19 Aug feedback deadline is missed', 'warn'),
    ev('e-08', '2024-08-21', 'Access', 'Agent-installation meeting; firewall-rules sheet sent to SBM', 'neutral'),
    ev('e-09', '2024-09-12', 'Environments', 'Direction to install directly on Production in Sprint 1, reversing the QA-first plan', 'warn'),
    ev('e-10', '2024-10-13', 'Prerequisites', 'SBM shares sensor-configuration documents; app owners must configure hosts first', 'neutral'),
    ev('e-11', '2024-11-04', 'Governance', 'Weekly Salam–SBM status meetings start', 'good'),
    ev('e-12', '2024-11-13', 'Digital', 'Website configured but port 443 not opened before the workshop', 'bad'),
    ev('e-13', '2024-11-21', 'Digital', 'Most UAT hosts of the MVNO app vendor still unconfigured', 'bad'),
    ev('e-14', '2024-12-22', 'Access', 'Port opening still pending — "access parked with Salam team"', 'bad'),
    ev('e-15', '2025-01-15', 'Delivery', 'Senior SBM resource onsite — the one period later cited as real progress', 'good'),
    ev('e-16', '2025-04-16', 'Governance', 'Weekly meetings resume (Wednesdays, to 1 Oct 2025)', 'neutral'),
    ev('e-17', '2025-04-29', 'Plan', 'Meeting where, per SBM, a schedule-extension CR was agreed — no CR followed', 'warn'),
    ev('e-18', '2025-05-26', 'BRD', 'SBM declares BRD V2.0 final ("consider this week as last")', 'warn'),
    ev('e-19', '2025-06-30', 'Domains', 'Impact: 48 VMs (under 25 %) installed; Big Data, Enterprise, Netaxis, MVNO: none', 'bad'),
    ev('e-20', '2025-07-01', 'Domains', 'SBM records Impact as closed by meeting agreement', 'bad'),
    ev('e-21', '2025-07-15', 'Digital', 'SBM shares the phased custom-event approach; custom events must be defined by Salam\'s business teams', 'neutral'),
    ev('e-22', '2025-08-06', 'Domains', 'Most domains past target dates; extension only by CR; FTTH B2C to close "if no update" by 20 Aug', 'bad'),
    ev('e-23', '2025-09-22', 'Digital', 'Alert demo: HTTP 200 with business code 14 is not detected', 'bad'),
    ev('e-24', '2025-10-21', 'Digital', 'Salam chooses FTTH first, MVNO second (sequential)', 'neutral'),
    ev('e-25', '2025-11-18', 'Escalation', 'IT Operations escalates: no dashboards, alerts, synthetics or validated staging case — no production deployment', 'bad', 'SBM: prerequisites took ~8 months, no SPOC, Salam declined to dedicate a resource; synthetics scope = availability + SSL.'),
    ev('e-26', '2025-11-24', 'Escalation', 'Digital production deployment request sent after weeks of follow-up', 'neutral'),
    ev('e-27', '2025-12-21', 'Escalation', 'CIO follow-up: one 30-minute meeting, then repeated postponements', 'bad'),
    ev('e-28', '2025-12-22', 'Commercial', 'SBM letter: "best effort" Salam engagement; asks for a CR, training, PAC / FAC and payment', 'bad'),
    ev('e-29', '2026-01-15', 'Freeze', 'Project frozen; architecture changes during the freeze (e.g. ServiceNow)', 'warn', 'Start date, reason and decision-maker of the freeze are not in the record.'),
    ev('e-30', '2026-09-30', 'Restart', 'Demo at SBM HQ; roadmap starts "once the payment is settled"', 'good'),
    ev('e-31', '2026-10-06', 'Restart', 'Eng. Ali T Atiah introduced as VP Operations; Yosri named Salam point of contact', 'good'),
    ev('e-32', '2026-10-07', 'Restart', 'SBM sends domain status (6 of 9 at 100 %) and proposes the session agenda', 'neutral'),

    /* ---- bottlenecks ---- */
    bn('b-pay', 'Roadmap waits for payment of SAR 856,256 (two held invoices)', 'critical', { owner: 'Ehab H Awwad (CIO) with Finance', date: '2026-09-30', sort: 1, data: { side: 'salam',
      next: 'Align with the CIO before the kickoff. Handle the two invoices separately: UAT2 against agreed Phase 2 evidence; the licence renewal against the frozen period (term extension or credit).' },
      body: 'The 30 Sep MoM ties the start of the roadmap to the payment of PPAC2/UAT2 (SAR 383,567) and the licence renewal (SAR 472,689).' }),
    bn('b-scope', 'Scope never baselined — the BRD is unsigned and conditional', 'high', { owner: 'Yosri A Yahmed with Procurement', date: '2024-06-04', sort: 2, data: { side: 'joint',
      next: 'One signed requirements matrix built from BRD V2.0, the technical proposal and the v1.3 remarks: every line Committed, Conditional (owner + date), Excluded or New. Named signatories on both sides.' } }),
    bn('b-data', 'Business data has no producer', 'high', { owner: 'Digital / BSS application owners', date: '2025-09-22', sort: 3, data: { side: 'salam',
      next: 'For each business KPI: source, instrumentation method, who codes it, who pays — costed as a Salam CR with the vendor and scheduled before SBM configures dashboards.' },
      body: 'Business codes (HTTP 200 + code 14), custom spans and KPI APIs all need Salam or vendor code changes nobody owned, planned or funded.' }),
    bn('b-prereq', 'Salam prerequisites late — ports, VPN, VMs, proxy VMs, access', 'high', { owner: 'Domain SPOCs (Salam)', date: '2024-08-21', sort: 4, data: { side: 'salam',
      next: 'Dependency register with named owners and dates, signed by their managers. A readiness gate before every session: ports verified, VPN, VMs, access, developers booked, agenda 48 h ahead.' },
      body: 'SBM claims the prerequisites took ~8 months.' }),
    bn('b-digital', 'Digital production deployment pending (DMS tested on staging; MVNO custom code)', 'high', { owner: 'IT Operations (Digital) · SBM', date: '2025-11-24', sort: 5, data: { side: 'joint',
      next: 'STG → PROD path with CAB lead times in the plan; deploy only against a validated staging case (dashboards, alerts, business codes).' } }),
    bn('b-vcenter', 'vCenter: not all 4 vCenters visible in Instana', 'medium', { owner: 'Salam SOC / NOC', date: '2026-10-07', sort: 6, data: { side: 'salam', next: 'Fix the connectivity issue; then agree the custom dashboards.' } }),
    bn('b-apollo', 'Apollo: applications to integrate not named', 'medium', { owner: 'Apollo SPOC (Salam)', date: '2026-10-07', sort: 7, data: { side: 'salam', next: 'Name the applications and their order (Salam asked to work in sequence).' } }),
    bn('b-vendors', 'Third-party vendors not engaged for Instana work', 'medium', { owner: 'Vendor managers', date: '2024-11-03', sort: 8, data: { side: 'salam',
      next: 'The MVNO app vendor, the DMS vendor, the website vendor and TCS confirm availability in writing before their tasks enter the plan.' },
      body: 'App vendor absent on 3 Nov 2024; DMS developers frustrated (Jul 2025); website vendor unavailable (Nov 2024).' }),

    /* ---- gaps ---- */
    gp('g-apm', 'Instana vs Grafana expectation gap — business KPIs, log search, SQL content', 'high', { owner: 'Yosri A Yahmed with IBM', sort: 1, data: { type: 'capability',
      next: 'IBM gives a written capability ruling on each contested item. Agree the split: Instana for APM, tracing, RUM, infra and synthetics; business KPIs via an agreed feed or Grafana.' },
      body: 'SBM (Oct–Nov 2025): log/DB search is not possible — "Instana is an APM tool". Grafana KPIs are DB/log-based, not API-based.' }),
    gp('g-codes', 'Business error codes not detected (HTTP 200 + business code 14)', 'high', { owner: 'SBM · IT Operations (Digital)', sort: 2, data: { type: 'capability', next: 'API error-code monitoring and alert e-mails in the validated staging case before production.' } }),
    gp('g-dash', 'No business dashboard accepted 15 months after the request; alerts never validated by L2', 'high', { owner: 'SBM · L2 teams', sort: 3, data: { type: 'outcome', next: 'Definition of done per domain: a production demonstration against the matrix lines, with screenshots, an alert test and owner sign-off.' } }),
    gp('g-silence', 'Closure by silence — Impact and FTTH B2C closed without evidence', 'high', { owner: 'Domain owners', sort: 4, data: { type: 'process', next: 'No auto-close: silence escalates to the steering instead. Reopen Impact and FTTH B2C for verification.' } }),
    gp('g-synth', 'Synthetic monitoring limited to SSL expiry and URL checks — no scripted journeys', 'medium', { owner: 'SBM · IBM', sort: 5, data: { type: 'scope', next: 'Ask IBM what scripted browser tests can cover (the training agenda lists browser tests) and price full journeys separately if needed.' } }),
    gp('g-env', 'Environment confusion — staging coupled to the Instana production instance', 'medium', { owner: 'IT Operations / Change Management', sort: 6, data: { type: 'process',
      next: 'Written environment strategy: which Instana backend is test and which is prod, the STG → PROD path and CAB lead times in the dates, no Prod change without an approved CRQ.' },
      body: 'The BRD allows two Instana platforms; a third needs a CR. The 2024 RUM scripts point to an "instana-test" cluster.' }),
    gp('g-new', 'Architecture changed during the freeze — ServiceNow, IBM Concert', 'medium', { owner: 'Yosri A Yahmed', sort: 7, data: { type: 'scope', next: 'Separate change backlog, priced and approved separately, outside the recovery baseline.' } }),
    gp('g-train', 'Training, documentation and support only weakly committed', 'medium', { owner: 'SBM', sort: 8, data: { type: 'scope', next: 'Quantity and duration written into the extension CR (SBM\'s 3-day agenda is a start).' }, body: 'In the BRD only in risk and closing prose; no quantity or duration.' }),

    /* ---- risks ---- */
    { key: 'r-case', kind: 'risk', title: 'SBM\'s documented counter-case reframes the discussion', severity: 'high', status: 'open', owner: 'Yosri A Yahmed', sort: 1,
      body: 'SBM can cite: the Sep 2024 PMO tracker showing Salam\'s digital domain owner as "Closed – no requirement to add"; a 6 Jul 2025 e-mail thanking SBM for the DMS component; CRs Salam owed (extension, Digital, DMS vendor); port 443 not opened (Nov 2024); sessions Salam moved or missed; late inputs; FTTH-first sequencing chosen by Salam; three invoices unpaid.',
      data: { likelihood: 'high', mitigation: 'Name Salam\'s own blockers first. Argue on outcomes: business codes not detected (Sep 2025), no accepted business dashboard 15 months after the request, alerts never validated by L2, domains closed without evidence.' } },
    { key: 'r-licence', kind: 'risk', title: 'Licence renewal paid for a frozen period', severity: 'medium', status: 'open', owner: 'Finance / Procurement', sort: 2,
      data: { likelihood: 'medium', mitigation: 'Review the renewal against the freeze; ask for a term extension or a credit.' } },
    { key: 'r-date', kind: 'risk', title: 'An end-2026 date committed before the dependency register exists', severity: 'medium', status: 'open', owner: 'Eng. Ali T Atiah', sort: 3,
      data: { likelihood: 'medium', mitigation: 'No end date before the register is agreed and each SPOC\'s time is approved by their manager.' } },

    /* ---- what the BRD really commits ---- */
    rq('q-01', 'Infrastructure, VMs, pods, DB health, long-running queries', 'committed', { sort: 1, data: { area: 'Infrastructure', reading: '"Can be covered" across MVNO, B2C and DB sections' } }),
    rq('q-02', 'APIs and integration points (success / failure, SADAD, SDA, 3scale)', 'committed', { sort: 2, data: { area: 'APIs', reading: 'Covered for supported technologies' } }),
    rq('q-03', 'Web and mobile RUM', 'committed', { sort: 3, data: { area: 'Digital', reading: 'Covered; needs the SDK in Salam\'s apps (Salam dependency)' } }),
    rq('q-04', 'Remedy auto-ticketing', 'committed', { sort: 4, data: { area: 'ITSM', reading: 'Integration "for auto ticketing purpose" using the API Remedy shared — committed in principle, no detail' } }),
    rq('q-05', 'Oracle IMPACT: L1/L2 dashboards, orders / failed orders, threshold alerts, e-mail + SMS, auto-TT', 'committed', { sort: 5, data: { area: 'IMPACT', reading: 'Section added by Salam (Aug 2024), never remarked on by SBM — strong claim; threshold alerts still depend on Salam' } }),
    rq('q-06', 'Executive dashboards (sales, revenue, region map)', 'committed', { sort: 6, data: { area: 'Business', reading: 'Requirement text with no SBM remark — committed by silence' } }),
    rq('q-07', 'Business KPIs elsewhere (B2B, B2C, MVNO DMS / MNP)', 'conditional', { sort: 7, data: { area: 'Business', reading: 'Only "if these KPIs are stored in the application / recorded in APIs" — conditional on Salam' } }),
    rq('q-08', 'Business alert thresholds', 'conditional', { sort: 8, data: { area: 'Business', reading: '"Will be shared later" by Salam' } }),
    rq('q-09', 'Synthetic monitoring', 'conditional', { sort: 9, data: { area: 'Synthetics', reading: 'Only SSL expiry and URL checks; scripted journeys not committed' } }),
    rq('q-10', 'Log parsing, user logs, SQL content', 'excluded', { sort: 10, data: { area: 'Logs', reading: 'Never committed; "user logs cannot be captured". The text supports DB and long-running-query monitoring, not log parsing or scripted journeys.' } }),
    rq('q-11', 'SaaS (Fusion, OCI), Tableau, DataRobot, network devices, firewalls, load balancers', 'excluded', { sort: 11, data: { area: 'Out of scope', reading: '"Not supported" / "can\'t be covered"' } }),
    rq('q-12', 'Training, documentation, support', 'conditional', { sort: 12, data: { area: 'Services', reading: 'Only in risk and closing prose; no quantity or duration' } }),
    rq('q-13', 'ServiceNow integration', 'new', { sort: 13, data: { area: 'ITSM', reading: 'Mentioned once as a generic capability — not a requirement: new scope' } }),

    /* ---- decisions for the VP ---- */
    dc('k-pay', 'The line on the two held invoices before the kickoff', 'Ehab H Awwad (CIO) · Eng. Ali T Atiah', { sort: 1, data: { vp: true },
      body: 'UAT2 (SAR 383,567) against agreed Phase 2 evidence; licence renewal (SAR 472,689) reviewed against the frozen period. Agree it with the CIO before meeting SBM.' }),
    dc('k-cond', 'Approve the conditions of the third baseline before it is signed', 'Eng. Ali T Atiah', { sort: 2, data: { vp: true }, body: 'The twelve safeguards under Governance — each answers a failure that already happened at least once.' }),
    dc('k-spoc', 'Named SPOC per domain with stated time, approved by the VP', 'Eng. Ali T Atiah', { sort: 3, data: { vp: true } }),
    dc('k-itsm', 'ITSM target: Remedy (delivered) or ServiceNow (new scope, separate CR)?', 'Eng. Ali T Atiah · ITSM', { sort: 4, data: { vp: true } }),
    dc('k-concert', 'IBM Concert: keep the estimate outside the recovery baseline', 'Ehab H Awwad (CIO)', { sort: 5, data: { vp: false } }),

    /* ---- conditions for the third baseline (safeguards) ---- */
    cd('c-01', 'Unsigned, conditional BRD', 'One signed requirements matrix built from BRD V2.0, the technical proposal and the v1.3 remarks; every line Committed, Conditional (owner + date), Excluded or New. No deemed acceptance; named signatories on both sides.', 'Yosri A Yahmed with Procurement', { sort: 1 }),
    cd('c-02', 'V2.0 narrowed scope without a CR', 'The three V2.0 remark changes go back to the v1.3 wording, or are accepted explicitly as a recorded scope decision.', 'Yosri A Yahmed', { sort: 2 }),
    cd('c-03', 'APM vs Grafana gap', 'IBM gives a written capability ruling on each contested item (business codes, log search, SQL, journey synthetics). Agree the split: Instana for APM, tracing, RUM, infra and synthetics; business KPIs via an agreed feed or Grafana.', 'Yosri A Yahmed with IBM', { sort: 3 }),
    cd('c-04', 'No producer for business data', 'For each business KPI: source, instrumentation method, who codes it, who pays. Costed as a Salam CR with the vendor, scheduled before SBM configures dashboards.', 'Digital / BSS application owners', { sort: 4 }),
    cd('c-05', 'Late prerequisites', 'Dependency register with named owners and due dates, signed by their managers. A readiness gate before every session: ports verified, VPN, VMs, access, developers booked, agenda sent 48 h ahead.', 'Domain SPOCs', { sort: 5 }),
    cd('c-06', 'Vendors not engaged', 'The MVNO app vendor, the DMS vendor, the website vendor and TCS confirm availability in writing before their tasks enter the plan.', 'Vendor managers', { sort: 6 }),
    cd('c-07', 'Resource availability', 'Named SPOC per domain with a stated time allocation, approved by the VP. SBM commits onsite senior days per week in the CR. Parallel tracks agreed, or sequencing accepted with its date impact.', 'Eng. Ali T Atiah (sponsor)', { sort: 7 }),
    cd('c-08', 'Environment confusion', 'Written environment strategy: which Instana backend is test and which is prod, the STG → PROD path and CAB lead times built into the dates, no Prod change without an approved CRQ.', 'IT Operations / Change Management', { sort: 8 }),
    cd('c-09', 'Closure by silence', 'Definition of done per domain: a demonstration in production against matrix lines, with screenshots, alert test and owner sign-off. No auto-close: silence escalates to steering instead. Impact and FTTH B2C reopened for verification.', 'Domain owners', { sort: 9 }),
    cd('c-10', 'Weak governance', 'Bi-weekly steering with decision rights (Salam VP, SBM account lead, IBM). One tracker as the single source of truth; MoM issued within 24 h, objections within 48 h, then final.', 'Yosri A Yahmed (SPOC)', { sort: 10 }),
    cd('c-11', 'Commercial coupling', 'Align with the CIO first (he holds the invoice action). Handle the two invoices separately: UAT2 payment against agreed Phase 2 evidence; licence renewal reviewed against the frozen period. The extension CR states PAC and FAC criteria up front.', 'Finance / Procurement', { sort: 11 }),
    cd('c-12', 'New scope during the restart', 'ServiceNow, IBM Concert and any post-freeze components go to a separate change backlog, priced and approved separately, outside the recovery baseline.', 'Yosri A Yahmed', { sort: 12 }),
    cd('c-13', 'Not to commit at the kickoff', 'Payment or invoice release (the CIO\'s action — agree the line with him beforehand) · SBM\'s completion percentages as accepted status · any end date before the dependency register is agreed · Salam staff time not approved by their managers · new requirements as part of the original contract.', 'Eng. Ali T Atiah', { sort: 13 }),

    /* ---- open questions before the workshop ---- */
    ac('a-proposal', 'Get SBM\'s technical proposal, the contract and any SOW from Procurement (the BRD says scope follows the proposal)', 'Yosri A Yahmed', null, 'open', { sort: 1, data: { from: 'Open questions before the workshop' } }),
    ac('a-b2plan', 'Find the second-baseline plan (to Nov 2025) and the minutes of the 29 Apr 2025 meeting', 'Yosri A Yahmed', null, 'open', { sort: 2, data: { from: 'Open questions before the workshop' } }),
    ac('a-freeze', 'Freeze: start date, reason and who decided', 'Mohamed F Hassan', null, 'open', { sort: 3, data: { from: 'Open questions before the workshop' } }),
    ac('a-invoice', 'Invoice status: was the 13 Feb 2025 invoice paid? Licence term dates against the freeze', 'Finance', null, 'open', { sort: 4, data: { from: 'Open questions before the workshop' } }),
    ac('a-itsm', 'ITSM platform today: Remedy (delivered "100 %") or ServiceNow (new)?', 'ITSM', null, 'open', { sort: 5, data: { from: 'Open questions before the workshop' } }),
    ac('a-env', 'Which Instana backend is production? (2024 RUM scripts point to "instana-test")', 'SBM · IT Operations', null, 'open', { sort: 6, data: { from: 'Open questions before the workshop' } }),
    ac('a-apollo', 'Apollo requirements: closed in the sign-off tracker but no BRD section', 'Apollo SPOC', null, 'open', { sort: 7, data: { from: 'Open questions before the workshop' } }),
    ac('a-evidence', 'Evidence behind Impact and FTTH B2C at 100 %: VM count, dashboards, sign-off', 'SBM', null, 'open', { sort: 8, data: { from: 'Open questions before the workshop' } }),
    ac('a-finance', 'Ask Finance to process the two held invoices', 'Ehab H Awwad (CIO)', null, 'open', { sort: 9, data: { from: 'MoM 30 Sep 2026' } }),
    ac('a-workshop', 'Arrange the requirements workshop; gap analysis to the CIO (in / out of scope, IBM confirmation, Concert roadmap)', 'Osama Eltaweel (SBM)', null, 'open', { sort: 10, data: { from: 'MoM 30 Sep 2026' } }),
    ac('a-trainees', 'Share the training attendees (L1, L2, administrators)', 'IT Operations', null, 'open', { sort: 11, data: { from: 'MoM 30 Sep 2026' } }),
    ac('a-concert', 'High-level estimate for migrating from Instana to IBM Concert after completion', 'SBM · IBM', null, 'open', { sort: 12, data: { from: 'MoM 30 Sep 2026' } }),

    /* ---- meetings & steerings ---- */
    { key: 'mt-0930', kind: 'meeting', title: 'Instana demo & restart — SBM HQ (Executive Blue Room)', date: '2026-09-30', status: 'held', sort: 1,
      body: 'IBM presented Instana\'s benefits and walked through its interfaces on a demo environment. SBM showed dashboards captured from Salam production for the domains in scope. Discussion of product capabilities, Salam\'s expectations, and SBM\'s effort on requirements Instana does not support (per IBM).',
      data: { type: 'steering', venue: 'SBM HQ', attendees: 'Salam (CIO, IT Operations), IBM and SBM — attendee list attached to SBM\'s MoM of 1 Oct 2026',
        decisions: ['The roadmap starts once the payment is settled and the remaining activities are agreed; both sides aim to finish before the end of 2026', 'A third rebaseline, with Salam\'s team dedicated to it', 'A bi-weekly steering (requested by the CIO)', 'Hands-on training for Salam\'s team'],
        actions: [
          { text: 'Ask Finance to process the two held invoices (UAT2 SAR 383,567; licence SAR 472,689, excl. VAT)', owner: 'Ehab H Awwad (CIO)', due: null, status: 'open' },
          { text: 'Arrange the requirements workshop; share a gap analysis with the CIO (consolidated requirements, in vs out of scope, IBM confirmation or Concert roadmap)', owner: 'Osama Eltaweel (SBM)', due: null, status: 'open' },
          { text: 'Share the training attendees and run the training', owner: 'Salam · SBM', due: null, status: 'open' },
          { text: 'High-level estimate for migrating to IBM Concert after completion', owner: 'SBM · IBM', due: null, status: 'open' }] } },
    { key: 'mt-kickoff', kind: 'meeting', title: 'Kickoff — requirements workshop (Salam · SBM · IBM)', date: null, status: 'planned', sort: 2,
      body: 'Review the project status against the agreed scope per area; the architecture updates made during the freeze (ServiceNow …); gather other requirements. Several sessions may be needed; SBM then runs the gap analysis for the CIO.',
      data: { type: 'workshop', attendees: 'Salam point of contact, IT Operations (per area), SBM, IBM', decisions: [], actions: [] } },
    { key: 'mt-steering', kind: 'meeting', title: 'Bi-weekly steering (Salam VP · SBM account lead · IBM)', date: null, status: 'planned', sort: 3,
      body: 'Requested by the CIO on 30 Sep. Proposed rules: decision rights; one tracker as the single source of truth; MoM within 24 h, objections within 48 h, then final.',
      data: { type: 'steering', cadence: 'Bi-weekly', attendees: 'Eng. Ali T Atiah, Yosri A Yahmed, SBM account lead, IBM', decisions: [], actions: [] } },
    { key: 'mt-cio25', kind: 'meeting', title: 'CIO follow-up meetings', date: '2025-12-03', status: 'held', sort: 4,
      body: 'A 30-minute CIO meeting, then repeated postponements; on 21 Dec the CIO did not join. SBM\'s letter of 22 Dec followed.', data: { type: 'escalation', decisions: [], actions: [] } },
    { key: 'mt-weekly25', kind: 'meeting', title: 'Weekly Salam–SBM status meetings', date: '2025-04-16', status: 'held', sort: 5,
      body: 'Wednesdays, 16 Apr – 1 Oct 2025 (a first series ran from 4 Nov 2024). A steering existed by Oct 2025 but recorded no decisions.', data: { type: 'weekly', cadence: 'Weekly (Wednesday)', decisions: [], actions: [] } },
    { key: 'mt-0429', kind: 'meeting', title: 'Plan review — schedule-extension CR "agreed" (per SBM)', date: '2025-04-29', status: 'held', sort: 6,
      body: 'Per SBM a CR to extend the schedule was agreed in this meeting. No CR followed; the minutes are an open question.', data: { type: 'review', decisions: [], actions: [] } },

    /* ---- escalation matrix (triggers proposed — to agree at the kickoff) ---- */
    es('x-s1', 'salam', 1, 'Yosri A Yahmed', 'Salam point of contact · IT Operations', 'Day to day: sessions, the readiness gate, the tracker, MoM within 24 h', { sort: 1 }),
    es('x-s2', 'salam', 2, 'Mohamed F Hassan', 'Enterprise Platforms & Operation Advisor', 'An action 5 working days late, a session missed or a dependency blocked', { sort: 2 }),
    es('x-s3', 'salam', 3, 'Eng. Ali T Atiah', 'VP Operations · sponsor', 'A milestone at risk; scope, resources or a steering decision', { sort: 3 }),
    es('x-s4', 'salam', 4, 'Ehab H Awwad', 'CIO', 'Commercial: invoices, CR, contract, baseline change', { sort: 4 }),
    es('x-v1', 'vendor', 1, 'Osama Eltaweel', 'Senior Project Manager · SBM', 'Plan, sessions, status, MoM', { sort: 5 }),
    es('x-v2', 'vendor', 2, 'Tarek Khattab · Mohamed Gamal', 'SBM delivery & account (roles to confirm)', 'Resources, onsite days, late deliverables', { sort: 6 }),
    es('x-v3', 'vendor', 3, 'Raed Wehbe · Diaa Bassiouni', 'IBM (roles to confirm)', 'Product capability rulings, roadmap (Concert)', { sort: 7 }),

    /* ---- money ---- */
    bl('l-uat2', 'PPAC2 / UAT2 acceptance — Phase 2', 383567, 'on_hold', '2025-11-09', 'Invoiced 9 Nov 2025. Pay against agreed Phase 2 evidence.'),
    bl('l-lic', 'Licence renewal', 472689, 'on_hold', '2026-01-06', 'Invoiced 6 Jan 2026. Review against the frozen period: term extension or credit.'),
    bl('l-feb25', 'Invoice of 13 Feb 2025', null, 'disputed', '2025-02-13', 'Listed by SBM as unpaid in Dec 2025 — confirm with Finance.'),

    /* ---- status updates ---- */
    up('u-1007', '2026-10-07', 'red', 'Restart under way — kickoff workshop to schedule', 'SBM status (7 Oct): 6 of 9 domains complete, vCenter 95 %, Apollo 85 %, Digital 50 %. Remaining: finish the domains, training, LLD and final documentation, one month of support. SBM runs a gap analysis after the workshop and checks the out-of-scope items with IBM. Salam named its point of contact (6 Oct); the VP Operations is the new sponsor.'),
    up('u-0930', '2026-09-30', 'red', 'Demo at SBM HQ — roadmap tied to the payment', 'The CIO took the action to ask Finance to process the two held invoices. Third rebaseline, training, bi-weekly steering and an IBM Concert estimate were agreed in principle.'),
    up('u-1118', '2025-11-18', 'red', 'Escalation — no production deployment until validated', 'IT Operations: no dashboards, alerts, synthetics or validated staging case — will not deploy to production. SBM: prerequisites took ~8 months, no SPOC, Salam declined to dedicate a resource.')
  ]
};

/* ================================================================== 2 · BSS migration R5/R6 (IMPACT · Oracle) */
const R5R6 = {
  key: 'r5r6',
  project: {
    slug: 'r5r6', name: 'BSS migration R5/R6 — Fixed onto Oracle RODOD', code: 'IMPACT R5/R6',
    vendor: 'Oracle', vendor_detail: 'Oracle (Projects delivery + Managed Services) · PMO & operations readiness: Systems Ltd · cutover / PMO: EY · testing: Systems Arabia',
    program: 'IMPACT — BSS transformation', segment: 'fixed', category: 'BSS migration',
    sponsor: 'IMPACT program — Ayoub M Ahmed · Fikry',
    owner: 'IT Operations readiness — Mohamed F Hassan (with Ahmad M Seifan, Khalid Albiss, Ahmed M Awadh)',
    vendor_pm: 'Nagarjuna Srinivasa (Oracle Projects) · Vamsi Krishna Nannapaneni (Oracle) · PMO: Muhammad Waseem Shahzad (Systems Ltd)',
    status: 'active', rag: 'amber', phase: 'Pre-go-live — PAT, operations readiness, cutover planning',
    progress: null, progress_verified: false, progress_basis: 'No delivery percentage reported. Operations readiness: 32-item checklist, several items delayed (8 Oct 2026).',
    start_date: '2025-06-17', baseline_end: '2026-09-15', end_date: null, baseline_no: null, go_live: null,
    brief: 'The IMPACT program\'s releases R5 and R6 move Salam\'s Fixed B2C business (5G and FTTH) from the legacy IWC stack onto Oracle RODOD — the Siebel, BRM/ECE, OSM, UIM, ASAP and AIA/OSB stack that already runs Mobile.\n\nFor IT Operations the question is acceptance into production: knowledge transfer, alarms and alerts, SOPs, capacity proven by a performance test (PAT) at the combined Mobile + Fixed peak, bill run and dunning inside the window, and a cutover that never stops Mobile customers. Oracle\'s cutover runbook (v0.03) carried an indicative go-live of 15 Sep 2026; in October the PAT environment is not decided, Oracle ETAs keep moving and four IT Operations actions are overdue — the go-live date is not confirmed.',
    objective: 'Fixed customers served from the same Oracle stack as Mobile with no degradation to Mobile (contractual), and an operations team able to run it from day one: monitored, documented, tested at peak, billed on time.',
    scope: 'Releases R5 and R6 of the IMPACT BSS transformation: Siebel CRM, BRM / ECE billing and charging, OSM / UIM / ASAP ordering, inventory and activation, AIA / OSB and 3Scale integration; migration from IWC (customers, balances, invoices and contract PDFs).\nOperations readiness: 32-item checklist — KT, monitoring, SOPs, PAT, licences, SSL certificates, production access, documentation, transition certificate.\nRaised by IT Operations, outside IMPACT scope: 3Scale HA, L3/L4 support, lifecycle and capacity; a separate BRM for Fixed and Mobile.',
    health: {
      schedule: { rag: 'red', note: 'The runbook v0.03 go-live (15 Sep 2026, indicative) has passed. Production access is planned for 10 Nov 2026 "near go-live"; no confirmed go-live date.' },
      scope: { rag: 'amber', note: 'FTTH isolation questions open in the impact tracker (17 Sep: separate MTA, queues, worker nodes, ASAP PRD, UIM reporting DB …). 3Scale HA and a separate BRM sit outside IMPACT scope.' },
      budget: { rag: 'grey', note: 'No budget figures in the documents provided. Known cost drivers: delta hardware (112 vCPU, 1 TB RAM, 10 TB per site), Siebel 500 user licences, a second 3Scale production resource.' },
      resources: { rag: 'amber', note: '3Scale production support is one person. IT Operations missed the 4 Oct alerts walkthrough; KT only started on 1 Oct (IT Ops asked for two months before go-live).' },
      quality: { rag: 'red', label: 'Ops readiness', note: 'Alarms and alerts, SOPs, SSL certificates and the API catalogue are delayed; capacity is not proven; the PAT environment is undecided.' },
      vendor: { rag: 'amber', note: 'Oracle ETAs breached repeatedly: licences and delta HW (22 Sep → 29 Sep → 26 Oct), SSL certificates (21 Sep → 30 Sep), SOP review (30 Sep).' }
    },
    budget: { currency: 'SAR', total: null, vat: null, note: 'Program budget not in the documents provided. The cost drivers known from the readiness thread are listed below without amounts.' },
    facts: [
      { label: 'Subscriber base', value: '560K', note: 'project inputs (FTTH impact tracker, 17 Sep)' },
      { label: 'Normal orders', value: '~20K / day', note: '~2K per hour (project slide)' },
      { label: 'Dunning peak', value: '~90K / h', note: 'at 3 AM · resumption ~11K / h at 4 AM' },
      { label: 'Capacity to prove', value: '100 TPS', note: 'and 18,000 orders / h (Oracle) — IT Ops: not how PROD performs today', tone: 'warn' },
      { label: 'Fixed digital peak', value: '53 TPS', note: '4 Oct 2026, 9 PM · average ≤ 3.8 TPS' },
      { label: 'Bill run target', value: '6–8 h', note: 'end to end, MVNO + Fixed · Mobile alone runs ~8 h today', tone: 'bad' },
      { label: 'Readiness checklist', value: '32 items', note: 'locked with IT Ops on 2 Apr 2026' },
      { label: 'Delta hardware', value: '112 vCPU · 1 TB', note: '+10 TB storage, per site (PROD and DR)' }
    ],
    accent: '#c74634', sort: 20
  },
  items: [
    /* ---- operations-readiness workstreams (status 8 Oct 2026) ---- */
    ws('w-kt', 'Knowledge transfer — KT sessions', 20, 'in_progress', { sort: 1, owner: 'Oracle (Nagarjuna Srinivasa) · PMO', ref: 'IM-63532', data: { remaining: 'Sessions started 1 Oct 2026. IT Ops asked for at least 2 months before go-live, 2 bill cycles and hypercare longer than 4 weeks.' } }),
    ws('w-alerts', 'Production alarms & alerts', 15, 'blocked', { sort: 2, owner: 'Oracle MS / Projects · IT Operations', ref: 'IM-63446', data: { remaining: 'MVNO alerts as-is for Fixed (Oracle, ETA 8 Oct). IWC business alerts from IT Ops (ETA 1 Oct, missed). Walkthrough of 4 Oct: nobody from IT Ops joined.' } }),
    ws('w-sop', 'Application SOPs on SharePoint', 30, 'at_risk', { sort: 3, owner: 'Oracle (Naga) · Brijesh Shah', ref: 'IM-63500', data: { remaining: 'Naga to review Brijesh\'s existing SOPs for Fixed (ETA 30 Sep, missed). Bill-run SOP after go-live.' } }),
    ws('w-pat', 'Performance acceptance test (PAT)', 25, 'at_risk', { sort: 4, owner: 'Oracle (Vamsi Krishna Nannapaneni)', ref: 'IM-63511', data: { remaining: 'ETA 26 Oct. Scope reviewed 4 and 6 Oct; environment not decided (UAT1 is 40 % of PROD).' } }),
    ws('w-cap', 'Capacity, licences & delta hardware', 30, 'at_risk', { sort: 5, owner: 'Oracle (Vamsi, Naga)', ref: 'IM-63512', data: { remaining: 'Delta HW 112 vCPUs / 1 TB RAM / 10 TB storage per site (PROD and DR); Siebel 500 user licences to check. ETA 26 Oct.' } }),
    ws('w-ssl', 'SSL certificates for the new integrations', 40, 'at_risk', { sort: 6, owner: 'Oracle (Naga, Utkarsh)', ref: 'IM-63513', data: { remaining: 'Nafath, Yakeen, ELM, GOSI, NAQEL, SIMAH, SDA Salam Home app / web, Sprinklr, CVM, IWC, Logisense. ETA 30 Sep, missed.' } }),
    ws('w-access', 'Production access', 0, 'not_started', { sort: 7, owner: 'IT Operations (approval) · Brijesh Shah', data: { remaining: 'Consolidated list for IT Ops approval near go-live. ETA 10 Nov 2026.' } }),
    ws('w-docs', 'Documentation (RD, DS, SAD)', 70, 'in_progress', { sort: 8, owner: 'Brijesh Shah (review)', data: { remaining: 'Links shared; review ETA 10 Oct 2026.' } }),
    ws('w-api', 'API catalogue & digital-channel KT', 10, 'at_risk', { sort: 9, owner: 'Oracle (Nagarjuna Srinivasa)', ref: 'IM-63534', data: { remaining: 'API integration catalogue for R5/R6 for Brijesh\'s review (ETA 1 Oct, missed).' } }),
    ws('w-gov', 'Governance — communication groups, org structure, stakeholder matrix', 30, 'blocked', { sort: 10, owner: 'IT Operations (Ahmad M Seifan, Khalid Albiss)', ref: 'IM-63523 · IM-63530', data: { remaining: 'Business communication groups (ETA 1 Oct) and confirmation of the Oracle MS org structure — PMO deadline Sun 11 Oct.' } }),
    ws('w-cutover', 'Cutover runbook', 35, 'at_risk', { sort: 11, owner: 'Oracle · EY · Salam Operations', data: { remaining: 'Runbook v0.03 (draft, indicative timelines). Salam objections D.1–D.4 open: monitoring suppression, MVNO queue pausing, application shutdown.' } }),

    /* ---- milestones ---- */
    ms('m-sd', 'Service design discussion', '2025-06-17', 'done', { done_at: '2025-06-17', sort: 1 }),
    ms('m-oss', 'OSS discussion with the IWC team', '2025-07-17', 'done', { done_at: '2025-07-17', sort: 2 }),
    ms('m-rep', 'Reporting migration sessions (DWH & Big Data)', '2025-08-25', 'done', { done_at: '2025-10-19', sort: 3, body: 'Twelve sessions, 25 Aug – 19 Oct 2025.' }),
    ms('m-list', 'Operations readiness list locked with IT Ops', '2026-04-02', 'done', { done_at: '2026-04-02', sort: 4 }),
    ms('m-arqami', 'Arqami SIT passed (FTTH, FWA)', '2026-06-23', 'done', { done_at: '2026-06-23', sort: 5 }),
    ms('m-rb', 'Cutover runbook v0.01 (Oracle)', '2026-07-11', 'done', { done_at: '2026-07-11', sort: 6 }),
    ms('m-overview', 'Solution overview for IT Ops & Oracle MS (3 sessions)', '2026-08-26', 'done', { done_at: '2026-09-10', sort: 7 }),
    ms('m-cut', 'Cutover strategy alignment', '2026-09-02', 'done', { done_at: '2026-09-02', sort: 8, body: 'Four Salam objections recorded (D.1–D.4).' }),
    ms('m-golive0', 'Go-live — indicative date in runbook v0.03', '2026-09-15', 'missed', { sort: 9, data: { gate: true, baseline: '2026-09-15' }, body: 'Passed with readiness items open.' }),
    ms('m-kt', 'KT sessions start', '2026-10-01', 'done', { done_at: '2026-10-01', sort: 10 }),
    ms('m-pats', 'PAT scope reviewed with IT Ops (2 parts)', '2026-10-06', 'done', { done_at: '2026-10-06', sort: 11 }),
    ms('m-docs', 'R5/R6 documentation reviewed', '2026-10-10', 'on_track', { sort: 12 }),
    ms('m-lic', 'Licences and delta hardware confirmed', '2026-10-26', 'at_risk', { sort: 13 }),
    ms('m-pat', 'PAT delivered — digital APIs, end to end', '2026-10-26', 'at_risk', { sort: 14, data: { gate: true } }),
    ms('m-access', 'Production access approved', '2026-11-10', 'planned', { sort: 15 }),
    ms('m-golive', 'Go-live', null, 'planned', { sort: 16, data: { gate: true }, body: 'Not confirmed.' }),
    ms('m-hyper', 'Hypercare — at least 2 bill cycles (IT Ops ask)', null, 'planned', { sort: 17 }),
    ms('m-cert', 'Signed transition certificate', null, 'planned', { sort: 18, data: { gate: true } }),

    /* ---- the story so far ---- */
    ev('e-01', '2025-06-17', 'Design', 'Service design discussion (recorded)', 'neutral'),
    ev('e-02', '2025-07-17', 'Design', 'OSS discussion with the IWC team', 'neutral'),
    ev('e-03', '2025-08-25', 'Reporting', 'Reporting migration sessions with DWH & Big Data start (12 sessions to 19 Oct 2025)', 'neutral'),
    ev('e-04', '2026-03-25', 'Readiness', 'Oracle\'s first answers on the readiness list — HA "not applicable" (no new nodes); licences and certificates to confirm', 'warn'),
    ev('e-05', '2026-04-02', 'Readiness', 'Readiness list locked with IT Operations', 'good'),
    ev('e-06', '2026-06-19', 'Stack', 'WebLogic patching in PROD (R7.2) completed on the same stack', 'good'),
    ev('e-07', '2026-07-11', 'Cutover', 'Oracle issues the cutover runbook v0.01', 'neutral'),
    ev('e-08', '2026-07-26', 'Readiness', 'Weekly operations-readiness alignment starts (PMO: Systems Ltd)', 'good'),
    ev('e-09', '2026-08-10', 'Readiness', 'IT Ops conditions: KT plan, 2 months before go-live, 2 bill cycles, hypercare longer than 4 weeks', 'warn', 'Oracle: a separate BRM for Fixed and Mobile is not possible in the current architecture (disputed).'),
    ev('e-10', '2026-08-26', 'Solution', 'Solution overview Part 1 (then Part 1.1 on 30 Aug, Part 2 on 10 Sep)', 'neutral'),
    ev('e-11', '2026-09-02', 'Cutover', 'Cutover strategy: Salam objects to four steps', 'bad', 'No monitoring suppression without justification; no pausing of MVNO-related queues; the application shutdown approach not agreed; any step affecting MVNO customers needs joint approval.'),
    ev('e-12', '2026-09-13', 'Capacity', 'IWC figures: 192,324 API calls / hour at peak; 183K SMS / hour (bill, SADAD and debt notifications)', 'warn', 'Digital channels\' own peak hour: 11,206 requests (28 Aug, 1 PM) — the gap blocks the PAT scope and the capacity exercise.'),
    ev('e-13', '2026-09-15', 'Go-live', 'Indicative go-live date of runbook v0.03 passes', 'bad'),
    ev('e-14', '2026-09-17', 'FTTH', 'FTTH impact tracker: isolation questions raised by Oracle MS (MTA, queues, worker nodes, ASAP PRD, UIM reporting DB …)', 'warn'),
    ev('e-15', '2026-10-01', 'Readiness', 'KT sessions start', 'good'),
    ev('e-16', '2026-10-04', 'PAT', 'PAT scope Part 1: environment not concluded; IT Ops absent at the alerts walkthrough', 'bad'),
    ev('e-17', '2026-10-06', 'PAT', 'PAT scope Part 2: 15 actions; Fixed digital peak measured at 53 TPS', 'neutral'),
    ev('e-18', '2026-10-08', 'Readiness', 'PMO to IT Operations: answer four delayed items by 11 Oct or they close as "no requirement"', 'bad'),

    /* ---- bottlenecks ---- */
    bn('b-env', 'PAT environment not decided — UAT1 is 40 % of PROD', 'critical', { owner: 'Ayoub M Ahmed · Fikry (IMPACT) with IT Operations', date: '2026-10-04', due: null, sort: 1, ref: 'IM-63511', data: { side: 'salam',
      next: 'Management decision: consolidate the other environments into UAT1, or free UAT2 (used for other purposes). Without it the PAT cannot prove capacity.' } }),
    bn('b-capacity', 'Capacity not proven: Oracle says 100 TPS and 18,000 orders / h; IT Ops: not how PROD performs', 'critical', { owner: 'Oracle (Vamsi Krishna Nannapaneni)', date: '2026-10-06', sort: 2, data: { side: 'vendor',
      next: 'PAT at the combined Mobile + Fixed peak, with dunning, resumption and 12,000 life-state changes a day; SADAD and ZATCA times measured.' },
      body: 'The FTTH impact tracker also warns the OSB limit of ~18K / hour is almost reached after FTTH.' }),
    bn('b-iwc', 'Legacy IWC statistics conflict: 192,324 calls / hour vs 11,206 at the channels\' peak hour', 'high', { owner: 'Hussein M Alnasib · Ahmad M Seifan (IWC / IT Operations)', date: '2026-09-15', sort: 3, data: { side: 'salam',
      next: 'One reconciliation call; peak API traffic per channel, monthly dunning counts, e-mail / SMS preference split.' }, body: 'Blocks the PAT scope and Oracle\'s PROD capacity exercise since mid-September.' }),
    bn('b-alerts', 'Monitoring for Fixed not ready — IWC business alerts overdue, walkthrough missed', 'high', { owner: 'Ahmad M Seifan (IT Operations) · Oracle (Naga)', date: '2026-09-20', due: '2026-10-11', sort: 4, ref: 'IM-63446', data: { side: 'salam',
      next: 'IT Ops to provide the IWC business alerts and a new walkthrough slot before 11 Oct; Oracle to implement MVNO alerts as-is for Fixed.' } }),
    bn('b-itops', 'Four IT Operations actions overdue — PMO will close them as "no requirement" on 11 Oct', 'high', { owner: 'Ahmad M Seifan (IT Operations)', date: '2026-09-30', due: '2026-10-11', sort: 5, ref: 'IM-63446 · IM-63520 · IM-63523 · IM-63530', data: { side: 'salam',
      next: 'Answer before Sunday 11 Oct: alerts, tools used for Fixed operations, communication groups, Oracle MS org structure.' } }),
    bn('b-tps', 'Combined Mobile + Fixed peak TPS and Fixed orders per hour pending', 'medium', { owner: 'Yosri A Yahmed (with TCS for Mobile)', date: '2026-10-06', due: '2026-10-08', sort: 6, data: { side: 'salam',
      next: 'Mobile digital-channel stats per second for the same window as Fixed (e.g. 4 Oct 9:04 PM); Fixed peak orders per hour.' }, body: 'Fixed stats delivered (peak 53 TPS); Oracle wants one view of both businesses in the same window.' }),
    bn('b-oracle', 'Oracle ETAs breached — licences / delta HW, SSL certificates, SOPs, API catalogue', 'medium', { owner: 'Oracle (Naga, Vamsi, Utkarsh)', date: '2026-09-22', sort: 7, ref: 'IM-63512 · IM-63513 · IM-63500 · IM-63534', data: { side: 'vendor',
      next: 'Escalate through the PMO (Shakeel Ahmed Anwar, Siddhant Mehta) with fixed dates.' } }),

    /* ---- gaps ---- */
    gp('g-3scale', '3Scale HA, L3/L4 support, lifecycle, geo-redundancy and capacity — outside IMPACT scope', 'high', { owner: 'Salam IMPACT (Mohammed F Haque, Zia Rehman)', sort: 1, data: { type: 'scope',
      next: 'Name an owner for each and decide a second 3Scale production resource with on-call backup before go-live.' }, body: 'Oracle MS manages 3Scale L1/L2. Production support today is one person. 3Scale baseline (16 Jul – 16 Aug): 3.19M requests, 1.11 % 5XX; the SADAD bill-run event reached 9.25 % 5XX.' }),
    gp('g-brm', 'Separate BRM for Fixed and Mobile — Oracle: not possible in the current architecture', 'high', { owner: 'Oracle · IMPACT', sort: 2, status: 'open', data: { type: 'architecture',
      next: 'Prove the shared bill run in PAT (two bill runs with Fixed + MVNO in lower environments, two suspension cycles) or reopen the design.' } }),
    gp('g-billrun', 'Bill run inside 6–8 h end to end, MVNO + Fixed, external calls included', 'high', { owner: 'Oracle (Vamsi)', sort: 3, data: { type: 'performance', next: 'Oracle targets billing, invoicing and PDF within 6 h — to prove in PAT; partial billing for Fixed to check.' } }),
    gp('g-ha', 'HA "not applicable" per Oracle (no new nodes) vs IT Operations\' concern', 'medium', { owner: 'Oracle · IT Operations', sort: 4, data: { type: 'architecture', next: 'Documented HA / DR position for the added Fixed load; full PROD → DR switch-over test during hypercare.' } }),
    gp('g-hyper', 'Hypercare of 4 weeks judged too short by IT Operations', 'medium', { owner: 'IMPACT · Oracle', sort: 5, data: { type: 'resource', next: 'Hypercare to cover at least two bill cycles and the first dunning peaks.' } }),
    gp('g-ftth', 'FTTH isolation questions open (impact tracker, 17 Sep)', 'high', { owner: 'Oracle Projects · application teams', sort: 6, data: { type: 'architecture',
      next: 'Answer each: separate MTA / pods for the FTTH bill run, AIA / OSB queues, Siebel components, ECE / OCOMC worker nodes, separate ASAP PRD, UIM reporting DB, order routing OSB vs 3Scale.' } }),
    gp('g-cutover', 'Cutover steps that touch Mobile customers not agreed (D.1–D.4)', 'high', { owner: 'Oracle Operations / DBA · Salam Operations', sort: 7, data: { type: 'process',
      next: 'Documented justification for every monitoring suppression, queue pause, cron-job stop or application shutdown; joint approval for anything affecting MVNO.' } }),
    gp('g-report', 'Daily operational report to senior management from Oracle production', 'low', { owner: 'IMPACT · IT IWC Operations', sort: 8, data: { type: 'reporting', next: 'Same table as today\'s IWC report (Open/Active → Closed/Resolved) in the daily e-mail body.' } }),

    /* ---- IT Operations acceptance requirements ---- */
    rq('q-kt', 'KT at least 2 months before go-live, with a detailed plan', 'open', { sort: 1, data: { area: 'Knowledge transfer', source: 'IT Ops, 10 Aug 2026' } }),
    rq('q-cycles', 'At least 2 bill cycles and 2 suspension cycles in lower environments before go-live', 'open', { sort: 2, data: { area: 'Billing', source: 'IT Ops, 10 Aug 2026' } }),
    rq('q-hyper', 'Hypercare longer than 4 weeks', 'open', { sort: 3, data: { area: 'Hypercare', source: 'IT Ops, 10 Aug 2026' } }),
    rq('q-cap', 'Oracle confirms RODOD hardware and software carry the R5/R6 load, with a contingency plan for hardware shortage', 'open', { sort: 4, data: { area: 'Capacity', source: 'IT Ops, 10 Aug 2026' } }),
    rq('q-bill', 'End-to-end bill run (MVNO + Fixed, external calls included) within 6–8 h', 'open', { sort: 5, data: { area: 'Billing', source: 'PAT scope, 4 Oct 2026' } }),
    rq('q-pat', 'PAT covers resumption with dunning, 12,000 life-state changes a day, SADAD and ZATCA times', 'open', { sort: 6, data: { area: 'PAT', source: 'PAT scope, 6 Oct 2026' } }),
    rq('q-nodeg', 'Existing production traffic (R5/R6 included) without degradation of performance, availability or service quality', 'committed', { sort: 7, data: { area: 'Contract', source: 'Contractual (PAT scope MoM, 6 Oct 2026)' } }),
    rq('q-alerts', 'Production alarms & alerts: MVNO alerts as-is for Fixed, plus the IWC business alerts', 'open', { sort: 8, data: { area: 'Monitoring', source: 'Readiness checklist' } }),
    rq('q-kpi', 'Monitoring KPI dashboard; contractual SLA / KPI; service and system availability KPIs', 'open', { sort: 9, data: { area: 'Monitoring', source: 'Readiness checklist (Oracle: post go-live)' } }),
    rq('q-sop', 'Application SOPs on SharePoint; R5/R6 bill-run SOP', 'open', { sort: 10, data: { area: 'SOP', source: 'Readiness checklist' } }),
    rq('q-freeze', 'Code freeze before go-live', 'open', { sort: 11, data: { area: 'Governance', source: 'Readiness checklist (Salam)' } }),
    rq('q-cert', 'Signed transition certificate', 'open', { sort: 12, data: { area: 'Transition', source: 'Readiness checklist (post go-live)' } }),
    rq('q-brm', 'Separate BRM for MVNO and Fixed', 'disputed', { sort: 13, data: { area: 'Architecture', source: 'IT Ops, Aug 2026', reading: 'Oracle: not possible in the current architecture' } }),
    rq('q-dr', 'Full switch-over test from primary to DR during hypercare', 'open', { sort: 14, data: { area: 'Resilience', source: 'FTTH impact tracker (FTTH-23)' } }),
    rq('q-daily', 'Daily operational report from Oracle production to senior management', 'open', { sort: 15, data: { area: 'Reporting', source: 'FTTH impact tracker (FTTH-22)' } }),

    /* ---- decisions ---- */
    dc('k-env', 'PAT environment: consolidate UAT1 (40 % of PROD) or free UAT2', 'Ayoub M Ahmed · Fikry — with Eng. Ali T Atiah', { sort: 1, data: { vp: true }, body: 'Open since 4 Oct; without it the PAT (ETA 26 Oct) cannot prove capacity.' }),
    dc('k-3scale', '3Scale: owner for HA, L3/L4, lifecycle and capacity — and a second production resource before go-live', 'Eng. Ali T Atiah · IMPACT', { sort: 2, data: { vp: true } }),
    dc('k-gates', 'Go-live gates from IT Operations: KT ≥ 2 months, 2 bill cycles, PAT pass at combined peak, alerts live', 'Eng. Ali T Atiah', { sort: 3, data: { vp: true }, body: 'Endorse them as the conditions of the transition certificate.' }),
    dc('k-cut', 'Cutover: Salam\'s position on monitoring suppression, MVNO queue pausing, application shutdown', 'Eng. Ali T Atiah · IMPACT', { sort: 4, data: { vp: true } }),
    dc('k-hyper', 'Hypercare length and the DR switch-over test', 'IMPACT · IT Operations', { sort: 5, data: { vp: false } }),

    /* ---- open actions (as of 8 Oct 2026) ---- */
    ac('a-alerts', 'Provide the IWC business alerts (as-is) to Oracle', 'Ahmad M Seifan', '2026-10-01', 'open', { sort: 1, ref: 'IM-63446', data: { from: 'Ops readiness, 30 Sep' } }),
    ac('a-walk', 'New slot for the as-is alerts walkthrough (IT Ops did not join on 4 Oct)', 'Ahmad M Seifan', '2026-10-11', 'open', { sort: 2, ref: 'IM-63446', data: { from: 'PMO, 5 Oct' } }),
    ac('a-tools', 'Confirm whether any tools are used for Fixed operations', 'Ahmad M Seifan', '2026-10-11', 'open', { sort: 3, ref: 'IM-63520', data: { from: 'PMO, 8 Oct' } }),
    ac('a-groups', 'Provide the business communication groups', 'Ahmad M Seifan', '2026-10-11', 'open', { sort: 4, ref: 'IM-63523', data: { from: 'PMO, 8 Oct' } }),
    ac('a-org', 'Confirm the Oracle MS operations org structure for Fixed / 5G', 'Ahmad M Seifan', '2026-10-11', 'open', { sort: 5, ref: 'IM-63530', data: { from: 'PMO, 8 Oct' } }),
    ac('a-tps', 'Mobile digital-channel peak TPS per second, same window as Fixed', 'Yosri A Yahmed (with TCS)', '2026-10-08', 'open', { sort: 6, data: { from: 'PAT scope, 6 Oct' } }),
    ac('a-orders', 'Fixed peak orders per hour for the PAT', 'Yosri A Yahmed', '2026-10-08', 'open', { sort: 7, data: { from: 'PAT scope, 6 Oct' } }),
    ac('a-iwc', 'IWC statistics: peak API traffic, monthly dunning counts, e-mail / SMS preference split', 'Hussein M Alnasib', '2026-09-22', 'open', { sort: 8, data: { from: 'PMO, 13 Sep' } }),
    ac('a-conf', 'Confidence that PROD carries 100 TPS and 18,000 orders / h', 'Vamsi Krishna Nannapaneni', null, 'open', { sort: 9, data: { from: 'PAT scope, 6 Oct' } }),
    ac('a-bill', 'End-to-end bill run in 6–8 h — answer to IT Ops after IMPACT / Oracle review', 'Vamsi Krishna Nannapaneni', '2026-10-06', 'open', { sort: 10, data: { from: 'PAT scope, 6 Oct' } }),
    ac('a-partial', 'Partial billing for Fixed', 'Vamsi Krishna Nannapaneni', '2026-10-06', 'open', { sort: 11, data: { from: 'PAT scope, 6 Oct' } }),
    ac('a-resume', 'PAT: resumption / reconnection together with dunning', 'Vamsi Krishna Nannapaneni', '2026-10-06', 'open', { sort: 12, data: { from: 'PAT scope, 6 Oct' } }),
    ac('a-3pp', 'Measure third-party times (SADAD bill upload, ZATCA QR code)', 'Vamsi Krishna Nannapaneni', null, 'open', { sort: 13, data: { from: 'PAT scope, 6 Oct' } }),
    ac('a-arch', 'Architecture / infrastructure of UAT1 and PROD', 'Vamsi Krishna Nannapaneni', '2026-10-06', 'open', { sort: 14, data: { from: 'PAT scope, 6 Oct' } }),
    ac('a-mvnoalerts', 'Analyse the MVNO alerts for implementation as-is for Fixed', 'Nagarjuna Srinivasa', '2026-10-08', 'open', { sort: 15, ref: 'IM-63446', data: { from: 'Ops readiness, 28 Sep' } }),
    ac('a-sop', 'Review the existing SOPs for Fixed and upload to SharePoint', 'Nagarjuna Srinivasa · Brijesh Shah', '2026-09-30', 'open', { sort: 16, ref: 'IM-63500', data: { from: 'Ops readiness, 28 Sep' } }),
    ac('a-ssl', 'SSL certificates for the newly integrated systems', 'Nagarjuna Srinivasa · Utkarsh', '2026-09-30', 'open', { sort: 17, ref: 'IM-63513', data: { from: 'Ops readiness, 28 Sep' } }),
    ac('a-catalog', 'API integration catalogue for R5/R6 (for Brijesh\'s review)', 'Nagarjuna Srinivasa', '2026-10-01', 'open', { sort: 18, ref: 'IM-63534', data: { from: 'Ops readiness, 30 Sep' } }),
    ac('a-docs', 'Review the R5/R6 documentation (RD, DS, SAD)', 'Brijesh Shah', '2026-10-10', 'open', { sort: 19, data: { from: 'Ops readiness, 22 Sep' } }),
    ac('a-3scale', 'Answer IT Ops on 3Scale L3/L4, lifecycle, geo-redundancy and capacity', 'Mohammed F Haque · Zia Rehman', null, 'open', { sort: 20, data: { from: 'Solution overview, 10 Sep' } }),

    /* ---- meetings ---- */
    { key: 'mt-1008', kind: 'meeting', title: 'Weekly alignment — IT Operations × Oracle MS (rescheduled from 7 Oct)', date: '2026-10-08', status: 'held', sort: 1,
      body: 'Weekly placeholder run by the PMO (Systems Ltd). The PMO followed up with IT Operations on four delayed items, with a deadline of Sunday 11 Oct.',
      data: { type: 'weekly', cadence: 'Weekly · Teams', attendees: 'IT Operations, Oracle MS, Oracle Projects, PMO (Systems Ltd), EY', decisions: ['Delayed IT Ops items close as "no requirement" if not answered by 11 Oct'],
        actions: [{ text: 'Answer IM-63446 / IM-63520 / IM-63523 / IM-63530', owner: 'Ahmad M Seifan', due: '2026-10-11', status: 'open' }] } },
    { key: 'mt-1006', kind: 'meeting', title: 'R5/R6 PAT scope review & walkthrough — Part 2', date: '2026-10-06', status: 'held', sort: 2,
      body: 'Walk-through of the proposed PAT scope: business scenarios and integrations in scope, API / transaction / volume coverage, IT Operations dependencies, test-environment requirements, gaps before PAT starts.',
      data: { type: 'workshop', attendees: 'Fikry, Ali, Ahmed M Awadh, Ahmad M Seifan, Hussein, Yosri, Farhan, Ananya, Navneeth, Vamsi, Touseef, Shahnawaz, Awais, Waseem',
        decisions: ['Existing production traffic, R5/R6 included, must keep its current level without any degradation (contractual)', 'UAT1 to be used as the PAT environment — IT Ops concern on its 40 % size still open', 'Oracle target: billing, invoicing and PDF generation within 6 h', 'RODOD API turnaround = API TAT + third-party TAT in sandbox'],
        actions: [
          { text: 'Peak TPS and detailed stats for Fixed digital channels', owner: 'Yosri A Yahmed', due: '2026-10-06', status: 'done' },
          { text: 'Fixed orders per hour', owner: 'Yosri A Yahmed', due: '2026-10-06', status: 'open' },
          { text: 'Consider the TPS for OSB and 3Scale', owner: 'Vamsi Krishna Nannapaneni', due: '2026-10-06', status: 'open' },
          { text: 'Partial billing for Fixed', owner: 'Vamsi Krishna Nannapaneni', due: '2026-10-06', status: 'open' },
          { text: 'E2E bill run within 6–8 h (MVNO + Fixed)', owner: 'Vamsi Krishna Nannapaneni', due: '2026-10-06', status: 'open' },
          { text: 'Resumption / reconnection PAT together with dunning', owner: 'Vamsi Krishna Nannapaneni', due: '2026-10-06', status: 'open' },
          { text: 'Confidence on 100 TPS and 18,000 orders / h', owner: 'Vamsi Krishna Nannapaneni', due: null, status: 'open' },
          { text: 'Third-party times (SADAD bill upload, ZATCA QR)', owner: 'Vamsi Krishna Nannapaneni', due: null, status: 'open' },
          { text: '12,000 life-state changes a day in PAT', owner: 'Vamsi Krishna Nannapaneni', due: null, status: 'open' },
          { text: 'Invoice PDF attached or in the e-mail body for Fixed customers', owner: 'Vamsi Krishna Nannapaneni', due: '2026-10-06', status: 'open' },
          { text: 'Architecture / infrastructure of UAT1 and PROD', owner: 'Vamsi Krishna Nannapaneni', due: '2026-10-06', status: 'open' },
          { text: 'Inter-component traffic-flow documents for Fixed', owner: 'PMO (Waseem)', due: null, status: 'done' }] } },
    { key: 'mt-1004', kind: 'meeting', title: 'R5/R6 PAT scope review & walkthrough — Part 1', date: '2026-10-04', status: 'held', sort: 3,
      body: 'Environment selection did not reach a conclusion: IT Ops raised its concern on UAT1 at 40 % and asked to consolidate the other environments into UAT1; IMPACT has only UAT1 and UAT2, and UAT2 is used for other purposes.',
      data: { type: 'workshop', attendees: 'Khalid, Ahmed M Awadh, Ahmad M Seifan, Hussein, Yosri, Farhan, Romil, Ananya, Biju, Navneeth, Vamsi, Touseef, Shahnawaz, Awais, Waseem',
        decisions: ['Environment selection escalated to management (Mr Ayoub and Mr Fikry)'], actions: [] } },
    { key: 'mt-0930', kind: 'meeting', title: 'Weekly operations readiness', date: '2026-09-30', status: 'held', sort: 4,
      body: 'Eleven action items (MoM of 1 Oct): KT, alarms and alerts, SOPs, PAT, licences, SSL, tools, API catalogue, IT Ops action list, 3Scale HA (outside IMPACT scope), separate BRMs (outside IMPACT scope).',
      data: { type: 'weekly', attendees: 'Ahmad M Seifan, Khalid, Ahmed M Awadh, Brijesh, Biju, Naga, Nida, Shakeel, Waseem',
        decisions: ['KT sessions start 1 Oct — M. Sayyed to align the training plan with IT Ops', '3Scale HA is outside IMPACT R5/R6 scope — Brijesh to send the risk and mitigation to Shakeel for escalation', 'Separate BRMs for Fixed and Mobile: Brijesh to raise the risks with evidence'],
        actions: [
          { text: 'Walkthrough of MVNO alerts to IT Ops (4 Oct 2 PM)', owner: 'Biju (Oracle MS)', due: '2026-10-04', status: 'done' },
          { text: 'Analyse the MVNO alerts for Fixed', owner: 'Naga (Oracle)', due: '2026-10-08', status: 'open' },
          { text: 'Business alerts from IWC as-is', owner: 'Ahmad M Seifan', due: '2026-10-01', status: 'open' },
          { text: 'API integration catalogue', owner: 'Naga (Oracle)', due: '2026-10-01', status: 'open' }] } },
    { key: 'mt-0922', kind: 'meeting', title: 'Weekly operations readiness', date: '2026-09-22', status: 'held', sort: 5,
      body: 'Seven action items: KT, alarms and alerts, SOPs, production access, licences, SSL certificates, documentation.',
      data: { type: 'weekly', attendees: 'Yosri, Awais, Brijesh, Ananya, Naga, Bala, Ranjith, Suganya, Sakshi, Shakeel, Waseem', decisions: [],
        actions: [{ text: 'Consolidated list of MVNO alerts to Oracle', owner: 'Brijesh Shah', due: '2026-09-22', status: 'done' }, { text: 'Delta hardware response', owner: 'Vamsi Krishna Nannapaneni', due: '2026-09-22', status: 'late' }] } },
    { key: 'mt-0910', kind: 'meeting', title: 'R5/R6 solution overview — Part 2 (after Part 1 on 26 Aug and Part 1.1 on 30 Aug)', date: '2026-09-10', status: 'held', sort: 6,
      body: 'Slide deck "IMPACT R5-6 Solution Walkthrough v0.1" and three recordings shared.',
      data: { type: 'review', attendees: 'Khalid, Yosri, Brijesh, Romil, Awais, Ranjith, Saurabh, Jhansi, Zia, Faizul, Zakir, Waseem',
        decisions: ['Oracle MS manages 3Scale L1 and L2'],
        actions: [{ text: 'Answer IT Ops on 3Scale L3/L4, lifecycle, geo-redundancy and capacity', owner: 'Mohammed F Haque · Zia Rehman (IMPACT)', due: null, status: 'open' }] } },
    { key: 'mt-0902', kind: 'meeting', title: 'Cutover strategy alignment (EY)', date: '2026-09-02', status: 'held', sort: 7,
      body: 'Oracle\'s runbook v0.03 and the TS-050 production conversion process reviewed. Thirteen actions for Oracle and Salam; four points Salam did not agree.',
      data: { type: 'workshop', venue: 'Fikry\'s room', attendees: 'IMPACT, IT Operations, Oracle, EY',
        decisions: ['D.1 — any migration activity affecting customer-facing services needs joint review and approval', 'D.2 — no suppression of monitoring e-mail alerts without operational justification', 'D.3 — no stopping MVNO-related processing through queue pausing', 'D.4 — the application shutdown approach is not agreed; deployment strategy to discuss', 'Cutover checkpoint twice a week (Fikry\'s availability)'],
        actions: [
          { text: 'Clarify the need to freeze IWC product-catalogue changes (catalogue already frozen)', owner: 'Oracle PM / Migration', due: null, status: 'open' },
          { text: 'Confirm whether OCI VM and RMAN backups include the MVNO base', owner: 'Oracle Infrastructure', due: null, status: 'open' },
          { text: 'Review the impact of pausing cron jobs on MVNO services and monitoring scripts', owner: 'Oracle DBA · Salam Operations', due: null, status: 'open' },
          { text: 'Revisit pausing PRODBRM / PRODASAP queues so MVNO is unaffected', owner: 'Oracle DBA · Salam Operations', due: null, status: 'open' },
          { text: 'Reassess shutting down RODOD applications during deployment; alternatives', owner: 'Oracle Application team', due: null, status: 'open' },
          { text: 'Confirm whether customers must be told before orders stop and the outage starts', owner: 'Salam Transformation', due: null, status: 'open' },
          { text: 'Forum to sync operational DB changes between ADM, IT Ops and Transformation', owner: 'Naveed Asim', due: '2026-09-03', status: 'open' }] } },
    { key: 'mt-0810', kind: 'meeting', title: 'Operations readiness — IT Ops conditions', date: '2026-08-10', status: 'held', sort: 8,
      body: 'IT Ops conditions recorded: KT plan first (nothing shown for months); at least 2 months before go-live; at least two bill cycles; 4 weeks of hypercare not sufficient. Capacity: current performance, KPIs and TPS to compare; a contingency plan for hardware shortage.',
      data: { type: 'weekly', decisions: ['Separate BRM for MVNO and Fixed: Oracle says not possible — disputed'], actions: [] } },

    /* ---- escalation matrix ---- */
    es('x-s1', 'salam', 1, 'Ahmad M Seifan · Khalid Albiss · Ahmed M Awadh', 'IT Operations leads (Fixed / IWC · Oracle MS liaison)', 'Day to day: readiness items, walkthroughs, alerts, access', { sort: 1 }),
    es('x-s2', 'salam', 2, 'Mohamed F Hassan', 'Enterprise Platforms & Operation Advisor', 'An IT Ops item past its ETA, or a vendor ETA breached twice', { sort: 2 }),
    es('x-s3', 'salam', 3, 'Eng. Ali T Atiah', 'VP Operations', 'Go-live gates, resources, a disagreement with IMPACT or Oracle', { sort: 3 }),
    es('x-s4', 'salam', 4, 'Ayoub M Ahmed · Fikry', 'IMPACT program leadership', 'Environment, scope and go-live decisions', { sort: 4 }),
    es('x-v1', 'vendor', 1, 'Nagarjuna Srinivasa · Brijesh Shah', 'Oracle Projects delivery · Oracle MS', 'Readiness deliverables, SOPs, alerts, documentation', { sort: 5 }),
    es('x-v2', 'vendor', 2, 'Vamsi Krishna Nannapaneni', 'Oracle — PAT, capacity, licences', 'Capacity answers, PAT, hardware and licences', { sort: 6 }),
    es('x-v3', 'vendor', 3, 'Shakeel Ahmed Anwar · Siddhant Mehta', 'PMO — Systems Ltd · EY', 'Escalation of breached ETAs to the program', { sort: 7, body: 'Oracle MS\'s own matrix: "Oracle Salam Org Structure and escalation matrix _MS.pptx" (shared Aug 2026).' }),

    /* ---- money (cost drivers, no amounts in the record) ---- */
    bl('l-hw', 'Delta hardware — 112 vCPUs, 1 TB RAM, 10 TB storage per site (PROD and DR)', null, 'planned', '2026-09-30', 'Requirement received from Oracle (IM-63512); cost not in the documents.'),
    bl('l-siebel', 'Siebel 500 user licences', null, 'planned', '2026-09-30', 'To be checked with Oracle (IM-63512).'),
    bl('l-3scale', 'Second 3Scale production support resource + on-call backup', null, 'planned', null, 'Decision required before go-live (3Scale production review).'),

    /* ---- status updates ---- */
    up('u-1008', '2026-10-08', 'amber', 'Readiness slipping on both sides', 'The PMO gave IT Operations until Sunday 11 Oct to answer four delayed items (alerts, tools, communication groups, org structure) or they close as "no requirement". PAT: environment not decided (UAT1 is 40 % of PROD); Oracle owes the capacity, bill-run and dunning answers; IT Ops owes the combined Mobile + Fixed peak TPS.'),
    up('u-0902', '2026-09-02', 'amber', 'Cutover strategy: four Salam objections', 'Salam did not agree to suppress monitoring e-mails without justification, to pause MVNO-related queues, or to the application shutdown approach; any step affecting MVNO customers needs joint approval.')
  ]
};

module.exports = { VERSION, PROJECTS: [INSTANA, R5R6] };
