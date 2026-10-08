/* opsCockpitSeed.js — the first content of the VP Operations cockpit (8 Oct 2026)
 *
 * Loaded ONCE by opsCockpit.seed() (console_settings key 'cockpit_seed' remembers the version). Every row carries a
 * seed key, so a seeded item someone later edits or deletes is never written back. Sources:
 *   · "RE: Salam IT Change Management || CAB - 7 Oct 2026" (IT Change Management, 7 Oct 18:25) — totals + 25 changes
 *   · "CHG0030330 | UPG Backend Change" (Hazem A Ghanem, 8 Oct 00:35) + the PIR form for CHG0030330
 *   · "5G HomeFi Blocked by Resource Locks" (Digital Ops → BSS, 7 Oct) and "Change Address throw Salam APP" (29 Sep – 7 Oct)
 * No customer identifier is copied in (no ID, MSISDN, account or service number): the cockpit is an executive page.
 * v2 (8 Oct 2026, alpha.150): console copy names the team "IT Operations", never "Digital Operations" — the CAB rows
 * stay as ITSM mailed them. A console seeded with v1 gets the same wording through opsCockpit.rewordSeed(). */
'use strict';

const CAB_2026_10_07 = {
  date: '2026-10-07',
  title: 'Salam IT Change Management || CAB - 7 Oct 2026',
  totals: { total: 25, normal: 25, standard: 0, emergency: 0, approved: 19, conditional: 1, moved: 0, hold: 0, rejected: 1, cancelled: 3, completed: 1, partial: 0, noPrereq: 0 },
  notes: 'Changes reviewed and approved by Salam Management in the CAB. Implement within the agreed window; notify stakeholders before start and at completion; L2 records the step-by-step implementation; PIR is mandatory for successful and rolled-back changes (reviewed every Sunday).',
  /* columns exactly as the CAB mail: Change ID · Area · Change/Release · Change Description · Impact · Owner · Date · Start · END ·
     Status (ITSM state) · Category · Security approval · Support Team · Implement Status (the CAB decision) · Prerequisites Checklist */
  rows: [
    ["CRQ000000197315", "Infra", "Change", "Installing hotfix patch 820SPH0105 for OceanStor Pacific 9550", "NA", "Mohammed Algumaizi", "8-Oct-26", "10/8/2026 5:00PM", "10/8/2026 10:00PM", "Request For Authorization", "Normal", "NA", "Infra", "Approved", "Reason for the change:Yes Impact to the service: NA Impact : Possible risk for old version RHEL 7 mounting the NFS share falls Rollback plan: Rolling Back the Software version. Attached in MoP Test results : NA Business approvals : Code Walkthrough with Operations Team: NA Right schedule: Oct 08, 2026: 05:00 PM - 10:00 PM Support doc : MOP Attached Implementor: Mohammed Algumaizi Checker: Habeebulla"],
    ["CHG0030325", "Remedy", "Change", "5G-FWA CTT Auto Resolved -- WO Status=Completed Reason=WO Failed", "No Impact", "Wajahat Khan", "8-Oct-26", "10/8/2026 2:00AM", "10/8/2026 7:00AM", "Assess", "Normal", "NA", "SDM OSS", "Approved", "Reason for change :Yes Impact to the service: No Impact : NA Rollback plan : Yes Test results : Yes Business approvals :Yes Code Walkthrough with Operations Team:NA Right schedule : Yes Support doc : Yes Implementor: Wajahath Khan Checker: Application owner"],
    ["CHG0030330", "Digital Apps", "Change", "UPG Backend Change", "Yes – UPG downtime 30 mins will switch to Hyperpay", "Sayyeda Zakir", "7-Oct-26", "10/7/2026 11:00PM", "10/8/2026 1:00AM", "Assess", "Normal", "NA", "Digital Apps", "Approved", "Reason for Change : Operations Requirement Impact to the Service : Yes – UPG downtime 30 mins will switch to Hyperpay Business / Technical Impact : No Rollback Plan: Yes Test Results / Validation Evidence: Yes Business Approvals: Yes Code Walkthrough with Operations Team: Yes Right Schedule / Approved Deployment Window: Yes Support Documentation: Yes Implementor Details: Systems Arabia Checker / Validation Owner Details: Digital Operations / Yosri"],
    ["CHG0030308", "Apollo || Siebel", "Change", "ADM-1240|| Order Notification – Include Child Orders in Notifications", "Siebel", "Taj", "8-Oct-26", "10/8/2026 6:30PM", "10/8/2026 11:00PM", "UAT Approved", "Normal", "NA", "MS team", "Approved", "Reason for change : yes Impact to the service: NA Impact : NA Implementation Plan : Yes Rollback plan : Yes Test results : Yes SIT3 -> Preprod ->Production: Tested in SIT Business approvals : Yes Support doc : Yes Implementer : MS – Siebel:Monica Checker : Shriyali"],
    ["CHG0030309", "Apollo || Siebel", "Change", "ADM-3644|| Enhance billprofile change order", "Siebel", "Kishore", "8-Oct-26", "10/8/2026 6:30PM", "10/8/2026 11:00PM", "UAT Approved", "Normal", "NA", "MS team", "Approved", "Reason for change : yes Impact to the service: NA Impact : NA Implementation Plan : Yes Rollback plan : Yes Test results : Yes SIT3 -> Preprod ->Production: Tewsted in SIT Business approvals : Yes Support doc : Yes Implementer : MS – Siebel:Monica Checker : Shriyali"],
    ["CHG0030311", "Apollo || BRM", "Change", "ADM-4050|| Change SALAM’s beneficiary bank account number", "BRM", "Gautam", "8-Oct-26", "10/8/2026 6:30PM", "10/8/2026 11:00PM", "UAT Approved", "Normal", "NA", "MS team", "Approved", "Reason for change : yes Impact to the service: NA Impact : NA Implementation Plan : Yes Rollback plan : Yes Test results : Yes SIT3 -> Preprod ->Production:Tested in SIT Business approvals : Yes Support doc : Yes Implementer : MS – Ravi Checker : Shriyali"],
    ["CHG0030313", "Apollo | Siebel| Edge Catalyst", "Change", "JIRA- 5659 - Updating Mwtype attribute for BBI service for migrated Siebel assets, wherever it is null", "Siebel", "Vivek", "7-Oct-26", "10/7/2026 6:30PM", "10/7/2026 11:30PM", "SIT in progress", "Normal", "N/A", "MS Team", "Approved", "Reason for change : yes Impact to the service: NA Impact : NA Implementation Plan : Yes Rollback plan : Yes Test results : Yes Business approvals : Yes Support doc : Yes Implementer : MS – Dinesh Checker : Anit"],
    ["CHG0030314", "Apollo | Siebel| Certificate Renewal", "Change", "Renewal of the siebel certificates for application to work correctly changes to be done in SIebel, AIA, OSB, Siebel LB (F5), UIM LB (Salam Infra)", "Siebel", "Monica/Saurab", "13-Oct-26", "10/13/2026 7:00PM", "10/13/2026 11:30PM", "NA", "Normal", "N/A", "MS Team", "Approved", "Reason for change : yes Impact to the service: NA Impact : NA Implementation Plan : Yes Rollback plan : Yes Test results : NA Business approvals : Yes Support doc : Yes Implementer : MS – Monica/Saurab Checker : Anit"],
    ["CHG0030327", "Apollo | ASAP", "Change", "SSL certificate renewal for the network elements UDM and PCRF", "ASAP", "Archana", "8-Oct-26", "10/8/2026 1:00AM", "10/8/2026 6:00AM", "Testing Completed", "Normal", "N/A", "MS Team", "Approved", "Reason for change : yes Impact to the service: Voice and Data Impact : NA Implementation Plan : Yes Rollback plan : Yes Test results : No Business approvals : Yes Support doc : Yes Implementer : Archana Checker : Balaji"],
    ["CHG0030315", "Impact || ADM || Seibel", "Change", "ADM-3124 = B2BM - Whitelisting Enhancement", "NA", "Ruhi", "8-Oct-26", "10/8/2026 1:00AM", "10/8/2026 6:00AM", "NA", "Normal", "NA", "MS", "Approved", "Reason for change : Yes Impact to the service: Na Impact : Na Implementation Plan : Yes Rollback plan : Yes Test results : Yes SIT3 -> Preprod ->Production:SIT3, preprod Business approvals : Yes Right schedule : Yes Support doc : Yes Implementer : MS Checker :Ranjit"],
    ["CHG0030316", "Impact || ADM || PDC", "Change", "ADM-3912 = B2CM - Adding a list of countries and operators to Roaming Pay as You Go", "NA", "Akshay", "8-Oct-26", "10/8/2026 1:00AM", "10/8/2026 6:00AM", "NA", "Normal", "NA", "MS", "Approved", "Reason for change : Yes Impact to the service: Na Impact : Na Implementation Plan : Yes Rollback plan : Yes Test results : Yes SIT3 -> Preprod ->Production:UAT2,SIT Business approvals : Yes Right schedule : Yes Support doc : Yes Implementer : MS Checker : Shreyas"],
    ["CHG0030317", "Impact || ADM || Seibel, BRM, SPC, PDC", "Change", "ADM-3477 = B300 GB data compensation add on valid for 365 days from provisioning date", "NA", "Ruhi, Lalita, Karthick Mohan, Akshay", "12-Oct-26", "10/12/2026 1:00AM", "10/12/2026 6:00AM", "NA", "Normal", "NA", "MS", "Approved", "Reason for change : Yes Impact to the service: Na Impact : Na Implementation Plan : Yes Rollback plan : Yes Test results : Yes SIT3 -> Preprod ->Production:UAT2,SIT3 Business approvals : Yes Right schedule : Yes Support doc : Yes Implementer : MS Checker : Ranjit, Zakir, Shabber, Shreyas"],
    ["CHG0030318", "Impact || OSM", "Change", "OSM application restart", "NA", "Sakshi", "8-Oct-26", "10/8/2026 1:00AM", "10/8/2026 6:00AM", "NA", "Normal", "NA", "MS", "Approved", "Reason for change : Yes Impact to the service: Na Impact : Na Implementation Plan : Yes Rollback plan : Yes Test results : NA Business approvals : Yes Right schedule : Yes Support doc : Yes Implementer : MS Checker : Sakshi"],
    ["CHG0030319", "MS || OCOMC SMS Flow updation", "Change", "Turing on the stopped flow for SMS from OCOMC to End-User", "NA", "Priyansh Singh", "12-Oct-26", "10/12/2026 1:00AM", "10/12/2026 6:00AM", "NA", "Normal", "NA", "MS", "Approved", "Reason for change : Yes Impact to the service: Yes Impact : Yes Rollback plan :Yes Test results : Yes Business approvals : Yes Right schedule :Yes Support doc :NA Implementor: MS Checker:"],
    ["CHG0030320", "Impact || Infra", "change", "Impact Siebel prod and dr F5 urls certificate renewal", "NA", "Solai", "12-Oct-26", "10/12/2026 1:00AM", "10/8/2026 4:00AM", "NA", "Normal", "NA", "Siebel/AIA/OSB", "Approved", "Reason for change : Yes Impact to the service: NA Impact : NA Implementation Plan : Yes Rollback plan : Yes Test results : NA Business approvals : Yes Right schedule : Yes Support doc : available Implementer : F5 Team Checker : Solai"],
    ["CHG0030321", "Impact || Infra", "change", "Increase capacity for PROD and DR BIP VMs", "NA", "Solai", "13-Oct-26", "10/13/2026 4:00AM", "10/13/2026 6:00AM", "NA", "Normal", "NA", "BIP/OAP", "Approved", "Reason for change : Yes Impact to the service: rolling restart Impact : NA Implementation Plan : Yes Implementation Plan : Yes Rollback plan : Yes Test results : NA Business approvals : Yes Right schedule : Yes Support doc : available Implementer : Solai Checker : Solai"],
    ["CHG0030322", "IMPACT|| SIEBEL", "Change", "Issue in Repurchase of Additional Data SIMs Once the Previous Additional Data SIM Is Terminated", "NA", "Ranjith", "11-Oct-26", "10/11/2026 1:00AM", "10/11/2026 6:00AM", "NA", "Normal", "NA", "MS", "Approved", "Reason for change : Yes Impact to the service: Na Impact : Na Implementation Plan : Yes Rollback plan : Yes Test results : Yes Business approvals : Yes Right schedule : Yes Support doc : Yes Implementer : Saurabh Checker :Ra"],
    ["CHG0030323", "IMPACT|| SIEBEL", "Change", "CR Expiry template change to include unified and customer account number", "NA", "Ranjith", "11-Oct-26", "10/11/2026 1:00AM", "10/11/2026 6:00AM", "NA", "Normal", "NA", "MS", "Approved", "Reason for change : Yes Impact to the service: Na Impact : Na Implementation Plan : Yes Rollback plan : Yes Test results : Yes Business approvals : Yes Right schedule : Yes Support doc : Yes Implementer : Saurabh Checker :Ranjit"],
    ["CHG0030326", "Impact || ASAP", "Change", "SSL certificate renewal for the network elements UDM and PCRF", "Voice and Data", "Archana", "8-Oct-26", "10/8/2026 1:00AM", "10/8/2026 6:00AM", "Testing Completed", "Normal", "N/A", "MS", "Approved", "Reason for change : Yes Impact to the service: Voice and Data Impact : Na Implementation Plan : Yes Rollback plan : Yes Test results : Pending Business approvals : Yes Right schedule : Yes Support doc : Yes Implementer : Archana Checker :Balaji"],
    ["CHG0030294", "Impact || ADM || Seibel", "Change", "ADM-2480 = B2CM - Additional Sim deactivation from DMS", "NA", "Ruhi", "8-Oct-26", "10/8/2026 1:00AM", "10/8/2026 6:00AM", "NA", "Normal", "NA", "MS", "Conditionally approved", "Reason for change : Yes Impact to the service: Na Impact : Na Implementation Plan : Yes Rollback plan : Yes Test results : Yes SIT3 à Preprod à Production / Low environment : to be tested in preprod Business approvals : Yes Right schedule : Yes Support doc : Yes Implementer : MS Checker :Ranjit"],
    ["CHG0030230", "IMPACT || BRM-ECE", "Change", "SSL Certificate Change", "NA", "Shabeer", "7-Oct-26", "10/7/2026 1:00AM", "10/7/2026 6:00AM", "NA", "Normal", "NA", "MS", "Completed", "Reason for change : Yes Impact to the service: NA Impact :NA Rollback plan : Yes Test results : Unit testing done, Preprod Pending Business approvals : yes Right schedule :Yes Support doc :Yes Implementor: Shabeer"],
    ["CHG0030329", "OSS Support", "Change", "Deploy Reappointment feature for ACES", "No Impact", "Jaynan Al Mutairi", "9-Oct-26", "10/9/2026 6:00AM", "10/9/2026 12:00PM", "Assess", "Normal", "NA", "ZSmart OSS (FTTx/5G/VAS)", "Rejected", "Reason for change : to Implement the ACES Reappointment feature. Impact to the service: downtime 5 min for the system. Impact : N/A Rollback plan : Attached in MOP Test results : N/A Business approvals : N/A Code Walkthrough with Operations Team: Done Right schedule : 9-Oct-26 Support doc : N/A Implementor: IWC Checker: Jaynan/Irshad"],
    ["CHG0030256", "Impact PROD BRM Database", "Change", "Impact PROD BRM Database parameter change to improve database performance", "NA", "Mazhar", "19-Sep-26", "9/19/2026 3:00AM", "9/19/2026 6:00AM", "NA", "Normal", "NA", "MS", "Canceled", "Reason for change : YES Impact to the service: NA Impact : None Implementation Plan : YES Rollback plan : YES Test results : N/A Business approvals : YES Right schedule : YES Support doc : Yes Implementer : Mohammad Mazhar Checker : Mohammad Mazhar"],
    ["CHG0030239", "Impact || BRM", "Change", "Partial Bill parameter implementation", "Yes", "Nishant/Shabeer", "16-Sep-26", "9/16/2026 1:00AM", "9/16/2026 6:00AM", "NA", "Normal", "", "AIA", "Canceled", "Reason for change : Yes Impact to the service: Yes Impact :Yes Rollback plan :NA Test results : Yes Business approvals : yes Right schedule :Yes Support doc :Yes Implementor: Nishant / Shabeer"],
    ["CHG0030229", "IMPACT || UIM", "Change", "UIM RAC Database change from SCAN IP to Hostname", "NA", "YaduPriya", "17-Sep-26", "9/17/2026 1:00AM", "9/17/2026 6:00AM", "NA", "Normal", "NA", "MS", "Canceled", "Reason for change : YES Impact to the service: NA Impact : NA Implementation Plan : YES Rollback plan : YES Test results : YES Business approvals : Right schedule : YES Support doc : YES Implementer : TUNAGAR EASHWAR Checker : Ajay Kumar/YaduPriya"],
  ]
};

/* CHG0030330 — implemented last night, notified at 00:35 KSA, PIR submitted (IT Change Management PIR template v2.6) */
const IMPLEMENTED = {
  CHG0030330: {
    impl_status: 'completed',
    actual_start: '2026-10-07T20:00:00Z',            // 23:00 KSA, 7 Oct
    actual_end: '2026-10-07T21:10:00Z',              // 00:10 KSA, 8 Oct
    result: 'Change done successfully and payment is under monitoring.',
    implementer: 'Systems Arabia',
    notified_by: 'Hazem A Ghanem (Fixed MS App L1 TL) — 8 Oct 00:35 KSA',
    pir: { rfcStatus: 'Successful', impact: 'No impact', backout: 'No', changeManager: '', changeOwner: 'Muhammad Hassan Javed',
      technician: 'Sayyeda Zakir', deploymentIssues: 'No issue', summary: 'Successful', lessons: 'N/A',
      submittedBy: 'IT Change Management PIR form', submittedAt: '2026-10-08T05:00:00Z' },
    segment: 'fixed'
  },
  CHG0030230: { impl_status: 'completed', result: 'Reported completed in the CAB of 7 Oct.' }
};

const UPDATES = [
  { seed_key: 'upg-chg0030330', tower: 'digital', segment: 'fixed', kind: 'change', tone: 'good', pinned: true,
    ref: 'CHG0030330', status: 'Completed · under monitoring', happened_at: '2026-10-07T21:10:00Z',
    title: 'UPG now double-checks payments when TAP misses the webhook — CHG0030330 live',
    body: 'Implemented last night: 23:00 → 00:10 KSA, inside the approved window, after the CAB of 7 Oct. IT Operations asked for this fix: when TAP captures a payment but never sends the webhook to Salam UPG, UPG now runs its own second get-status check and completes the order. The missing webhook was hurting customers (paid, nothing happened), the call center, operations, the big-data reports and the business. Tested — the fix works; payments are under monitoring. PIR submitted: successful, no impact, no back-out.',
    impact: ['Customers', 'Call center', 'Operations', 'Big data reports', 'Business'],
    created_by: 'IT Operations' }
];

const CHALLENGES = [
  { seed_key: '5g-homefi-resource-locks', tower: 'bss', segment: 'fixed', severity: 'critical', status: 'in_progress',
    title: '5G HomeFi ePurchase blocked by BSS / DRM resource locks',
    impact: 'Since the 17 Sep launch about 90% of 5G HomeFi ePurchase journeys stop at the location step. 30 of 35 white-label SIMs and 34 landline numbers are locked, so new SIM sales are blocked.',
    detail: 'When a journey is cancelled or abandoned, the SIM (ICCID) and landline number it reserved in BSS / DRM stay locked. Latest check, 7 Oct 17:40: DRM querySimCard answers resultCode 0 "Success" with an empty SIM list (simCardDtoList = null), so the journey shows "no SIM card available".',
    fix_owner: 'BSS team (BSS Operations)', followed_by: 'IT Operations — L2',
    next_step: 'BSS to (1) release the 26 locked-only ICCIDs with their landline numbers and cancel the Semati registration where applicable; (2) leave the 4 resources already sold and anything with an ORDER_CREATED record; (3) release locks on cancel and on expiry, with a scheduled sweep that skips sold resources; (4) confirm the unlock runs on the BSS side for both flows.',
    since: '2026-09-17', refs: 'Mail "5G HomeFi Blocked by Resource Locks" (7 Oct) · DRM querySimCard',
    created_by: 'IT Operations',
    notes: [
      { at: '2026-10-07T12:47:00Z', by: 'Michael ElSabie · IT Operations L2', tag: 'Raised to BSS', body: 'Raised to BSS: ~90% of journeys stop at the location step since launch; 30/35 white-label SIMs and 34 landline numbers locked. Asked to release the 26 locked-only ICCIDs, keep the sold ones, release on cancel / expiry and confirm the unlock on the BSS side.' },
      { at: '2026-10-07T14:23:00Z', by: 'Wadhah A Qaid', tag: 'Operations looped', body: 'Operations looped in — to be taken with the BSS operation team.' },
      { at: '2026-10-07T14:40:00Z', by: 'Michael ElSabie · IT Operations L2', tag: 'Empty SIM list', body: 'DRM querySimCard returns "Success" with an empty SIM list (simCardDtoList = null) → the journey shows "no SIM card available".' },
      { at: '2026-10-08T05:00:00Z', by: 'IT Operations', kind: 'status', status_to: 'in_progress', tag: 'Under fix · BSS', body: 'Under fix by the BSS team — Operations following.' }
    ] },
  { seed_key: 'ftth-relocation-dawiyat-slotid', tower: 'digital', segment: 'fixed', severity: 'high', status: 'in_progress',
    title: 'FTTH relocation in the Salam app fails for DAWIYAT addresses (slotId)',
    impact: 'Customers pay the relocation fee in the app (Change Address) but the BSS order is rejected after payment, so the move is never created and the customer waits. Back office reports several customers; first confirmed failure 2 Oct.',
    detail: 'The BSS relocation API answers CC-S-SALES-01014 "The parameter[slotId] should not be null" for DAWIYAT. slotId was never required since the relocation launch; BSS now needs the slotId of the selected appointment for DAWIYAT only (not for the third-party provider). Whale Cloud, 7 Oct 14:34: the null slotId comes from the DAWIYAT side although the appointment was sent.',
    fix_owner: 'Digital team, with BSS (TCS) and Whale Cloud', followed_by: 'IT Operations — L2',
    next_step: 'Digital to send the appointment slotId on DAWIYAT relocations. BSS / Whale Cloud to share a request validated in Postman with slotId and confirm with DAWIYAT why slotId comes back null. Paid cases followed one by one with BSS until the fix is live.',
    since: '2026-10-02', refs: 'Mail "Change Address throw Salam APP" (29 Sep – 7 Oct) · CC-S-SALES-01014',
    created_by: 'IT Operations',
    notes: [
      { at: '2026-10-04T09:03:00Z', by: 'Michael ElSabie · IT Operations L2', tag: 'Order rejected', body: 'Customer paid, order creation failed: CC-S-SALES-01014 "slotId should not be null" — while other relocations without slotId went through.' },
      { at: '2026-10-04T11:50:00Z', by: 'Md Shahnawaz Ahmad · BSS (TCS)', tag: 'BSS needs slotId', body: 'The slotId generated for the selected appointment date is required for DAWIYAT; not required for the third-party provider.' },
      { at: '2026-10-04T13:34:00Z', by: 'Michael ElSabie · IT Operations L2', tag: 'New requirement', body: 'slotId was not mandatory since the relocation launch — a new requirement; raised to Wadhah A Qaid.' },
      { at: '2026-10-07T10:11:00Z', by: 'Michael ElSabie · IT Operations L2', tag: 'Postman test asked', body: 'Asked BSS for valid request parameters including slotId, tested in Postman, before implementing on the digital side.' },
      { at: '2026-10-07T11:34:00Z', by: 'Whale Cloud (Yulin Wu)', tag: 'DAWIYAT side', body: 'The issue is on the DAWIYAT side: slotId comes back null although the appointment was sent — to be confirmed with DAWIYAT.' },
      { at: '2026-10-08T05:00:00Z', by: 'IT Operations', kind: 'status', status_to: 'in_progress', tag: 'Fix in progress · Digital', body: 'Fix in progress by Digital — Operations following.' }
    ] },
  /* STC Pay (Mobile) — "STC Pay Payment Method Update" (Tap notice 26 Aug → disabled in UPG 1 Sep) and "[URGENT] STC Pay 100%
   * failure on HyperPay since go-live (result code 800.100.156 — format error)" (3 – 20 Sep). Today's line is the state the
   * Head of Digital Operations gave on 8 Oct: back on UPG / Tap with STC Pay disabled, re-enable under discussion. */
  { seed_key: 'stcpay-mobile-disabled', tower: 'digital', segment: 'mobile', severity: 'high', status: 'in_progress',
    title: 'STC Pay disabled on Mobile payments — re-enabling it is under discussion',
    impact: 'Mobile (MVNO) customers cannot pay with STC Pay — recharges, bills, advance payments, new lines, change of plan — since 1 Sep; card (mada, Visa, Mastercard, AMEX) and Apple Pay work. Over the 12 months before, STC Pay carried 12.4% of successful payments (327,510) but 20.7% of all failures (114,802): 74.0% success against 82.7% for all methods.',
    detail: 'Tap announced on 26 Aug that STC Pay wallets are being phased out with the STC Pay → STC Bank transition and would be deactivated. IT Operations removed STC Pay from every payment page (web and app) in a controlled change approved by Demand and Business, live 1 Sep 00:00. On 3 Sep at 16:27 all payment traffic moved to HyperPay as the only gateway: STC Pay failed 100% — 235 of 235 attempts declined with result 800.100.156 (format error) on iOS, Android and web, while mada (~87%) and Visa (~82%) went through. It cannot work there until Salam\'s merchant account with STC Bank exists (the financial contract). Payments are back on UPG / Tap with STC Pay still disabled.',
    fix_owner: 'Salam Finance & Business (STC Bank account), with Digital and HyperPay / Tap', followed_by: 'IT Operations',
    next_step: 'Agree the route for STC Pay (Tap or HyperPay) and get Salam\'s STC Bank merchant account created — Finance to complete the steps HyperPay asked for on 13 Sep. Then test STC Pay end to end, set the date with Business, brief the call centre and switch it back on, web and app.',
    since: '2026-09-01', refs: 'Mails "STC Pay Payment Method Update" (26 Aug – 1 Sep) · "[URGENT] STC Pay 100% failure on HyperPay since go-live (800.100.156)" (3 – 20 Sep) · salam-nexus MR 3808',
    created_by: 'IT Operations',
    notes: [
      { at: '2026-08-26T14:17:00Z', by: 'Tap — Payment Acceptance', tag: 'Tap notice', body: 'With the STC Pay → STC Bank transition, STC Pay wallets are being gradually discontinued; STC Pay will be deactivated from Salam\'s payment methods.' },
      { at: '2026-08-27T08:04:00Z', by: 'Yosri A Yahmed · IT Operations', tag: 'Removal requested', body: 'Asked Delivery to hide STC Pay on every Salam payment page (recharge, invoice, advance payment, onboarding checkout, change plan — web and app), card and Apple Pay unchanged, with Demand and Business approval. 12 months of data: STC Pay = 12.4% of successful payments, 20.7% of failures, 74.0% success against 82.7%.' },
      { at: '2026-08-27T08:13:00Z', by: 'Ahmed A Zaidani', tag: 'Revenue owner in', body: 'Revenue owner added; customers to be informed of the change so there is no confusion.' },
      { at: '2026-08-31T12:42:00Z', by: 'Ghassan N Shoujen · Ahmed A Zaidani', tag: 'Approved', body: 'Approved by Ghassan N Shoujen (13:58) and Ahmed A Zaidani (15:42) for Demand and Business. Delivery shared the merge request (salam-nexus MR 3808); change scheduled 23:00.' },
      { at: '2026-08-31T21:00:00Z', by: 'Yosri A Yahmed · IT Operations', tag: 'Disabled in UPG', body: 'STC Pay disabled in UPG successfully — all other payment methods working.' },
      { at: '2026-09-03T13:27:00Z', by: 'IT Operations', tag: 'Moved to HyperPay', body: 'All customer payment traffic switched to HyperPay as the only gateway.' },
      { at: '2026-09-03T14:56:00Z', by: 'Yosri A Yahmed · IT Operations', tag: '100% failure', body: 'STC Pay 0% success on HyperPay: 235 of 235 attempts (16:27–17:51) declined with 800.100.156 "format error", same on iOS, Android and web, while mada (~87%) and Visa (~82%) succeed. Escalated to HyperPay as urgent (reminders 20:38 and 21:15).' },
      { at: '2026-09-09T11:28:00Z', by: 'Mian T Nasruddin · Director Digital Experience', tag: 'Chased', body: 'Asked HyperPay for the status.' },
      { at: '2026-09-13T07:11:00Z', by: 'HyperPay — Chief Revenue Officer', tag: 'STC Bank agrees', body: 'STC Bank agreed to reactivate Salam\'s account; Salam Finance asked to call HyperPay to complete the required steps.' },
      { at: '2026-09-20T13:37:00Z', by: 'Ghassan N Shoujen', tag: 'Account pending', body: 'HyperPay offered to activate STC Pay (15:23); Salam is still pushing STC Bank to create the account — no result yet.' },
      { at: '2026-10-08T05:00:00Z', by: 'IT Operations', kind: 'status', status_to: 'in_progress', tag: 'Back on UPG / Tap', body: 'Payments are back on UPG / Tap with STC Pay disabled; discussions ongoing to re-enable STC Pay — Operations following.' }
    ] },
  /* Unifonic SMS credit — "SMS TOPUP request" (8 Sep – 4 Oct) and the DOT Monitoring alert "UnifonicPointsWarning [FIRING]" (28 Sep).
   * Two sides kept apart on purpose: WHY it must be solved now (one account carries every SMS flow) and WHAT Commercial asks
   * for (an RFQ on price, the volume justified and cut). Numbers are the ones stated in the thread, with who stated them. */
  { seed_key: 'unifonic-sms-credit', tower: 'digital', segment: 'both', severity: 'critical', status: 'in_progress',
    title: 'Unifonic SMS credit low — top-up pending while Commercial pushes to cut SMS volume',
    impact: 'Every SMS Salam sends goes through one Unifonic account: the OTPs of onboarding, payments and app login (Digital), bills and reminders (BSS), field and appointment messages (OSS). If the credit runs out, onboarding and payments stop at the OTP step and customers stop receiving bills and notifications — on Mobile and Fixed at once. The balance fell under the 200,000-point warning on 28 Sep (166,363 points left).',
    detail: 'Commercial raised an RFQ on 8 Sep because the SMS cost is too high, and is asking every team to justify and reduce volume. What the thread established:\n• ≈ 18M SMS units a month — 15M from FTTH BSS, 3M from all other systems (IT, 22 Sep).\n• By Unifonic account: 177.9M units in 2025 and 150.3M in 2026 up to September, 82% on the main IT integration account.\n• Digital platforms send ≈ 0.3–0.4M messages a month (3.74M in 2025, 2.93M in 2026 to 9 Sep); payment OTP ≈ 70% of the Fixed digital volume. Messages ≠ billed units: long bilingual messages are several units each (the consent OTP ≈ 12).\n• Commercial asks: 13–14M SMS a month for a base of 161K customers?\n• Levers: Segment already rewrote 200+ texts and needs the costliest ones; the limit is 64 characters per SMS in Arabic, 128 in English; existing BSS SMS cannot change before the R5 / R6 migration (early Dec 2026).',
    fix_owner: 'Commercial & Procurement (top-up, RFQ), with IT (Unifonic account), Segment (texts) and BSS (bill SMS)', followed_by: 'IT Operations',
    next_step: '1) Commercial / Procurement: close the RFQ and top up now — the volume work cannot hold the top-up. 2) IT: Unifonic units per account and sub-account (Salammobile, Etihad Salam Telecom), Jan 2025 → Sep 2026, with the top senders named. 3) BSS: stop unwanted bill and reminder SMS (the 15M units / month); text changes after R5 / R6 in early December. 4) Segment: shorten the costliest texts to 64 Arabic / 128 English characters, one language per message. 5) Digital: longer payment-OTP validity / session reuse to cut the payment OTPs.',
    since: '2026-09-08', refs: 'Mails "SMS TOPUP request" (8 Sep – 4 Oct 2026) · DOT Monitoring "UnifonicPointsWarning [FIRING]" (28 Sep, RUH-IntegrationP01)',
    created_by: 'IT Operations',
    notes: [
      { at: '2026-09-08T07:30:00Z', by: 'Mamoun O Abu Salah', tag: 'Few days left', body: 'A few days remain before the SMS balance runs out — asked to expedite the top-up.' },
      { at: '2026-09-08T14:25:00Z', by: 'Waqas B Bashir', tag: 'RFQ raised', body: 'RFQ raised to get the lowest price — the SMS cost is too high; procurement to finalise.' },
      { at: '2026-09-09T14:37:00Z', by: 'Yosri A Yahmed · IT Operations', tag: 'Digital volumes shared', body: 'Monthly digital SMS volumes shared, Mobile vs Fixed: 3.74M in 2025, 2.93M in 2026 to 9 Sep. Payment OTP ≈ 70% of the Fixed volume; message count ≠ billed units. Asked IT for the Unifonic units per account to reconcile.' },
      { at: '2026-09-10T09:03:00Z', by: 'Waqas B Bashir', tag: 'Splits requested', body: 'Asked for bill and reminder SMS split Mobile vs Fixed, the internal SMS usage and the OSS SMS.' },
      { at: '2026-09-21T14:48:00Z', by: 'Waqas B Bashir', tag: 'Accounts breakdown', body: 'Unifonic by account: 177.9M units in 2025, 150.3M in 2026 to September — 82% on the main IT integration account. Asked what types of SMS they are.' },
      { at: '2026-09-22T12:55:00Z', by: 'Mamoun O Abu Salah', tag: '18M units / month', body: '≈ 18M SMS units a month: 15M for FTTH BSS, 3M for all other systems; details requested from Unifonic.' },
      { at: '2026-09-27T08:59:00Z', by: 'Waqas B Bashir', tag: '13–14M for 161K?', body: 'To Segment: are we sending 13–14M SMS a month for a base of 161K? Per-sender monthly volumes shared.' },
      { at: '2026-09-27T14:53:00Z', by: 'Saleh N Musaynid', tag: '200+ texts rewritten', body: 'Over 200 texts already revamped; needs the SMS with the highest impact and the Arabic / English length limits.' },
      { at: '2026-09-28T11:15:00Z', by: 'DOT Monitoring', tag: 'Points warning', body: 'UnifonicPointsWarning FIRING — 166,363 points left (warning under 200,000): schedule a top-up.' },
      { at: '2026-09-29T08:02:00Z', by: 'Waqas B Bashir', tag: 'Who sends bills?', body: 'Who sends the bill SMS and how can unwanted SMS be stopped? Referred to Atif K ElEissawi.' },
      { at: '2026-09-30T10:11:00Z', by: 'Waqas B Bashir', tag: 'Meeting: cut SMS', body: 'Critical meeting: reduce SMS by monetising the SMS journey; Unifonic\'s per-SMS character limit so Segment can shorten texts; no CR on existing SMS during the R5 / R6 migration; use the enhanced Oracle journey once live.' },
      { at: '2026-09-30T12:39:00Z', by: 'Saleh N Musaynid', tag: 'R5 / R6 early Dec', body: 'R5 & R6 launch planned for early December 2026.' },
      { at: '2026-10-04T08:15:00Z', by: 'Mamoun O Abu Salah', tag: '64 AR / 128 EN', body: 'Character limit per SMS: 64 Arabic, 128 English.' },
      { at: '2026-10-08T05:00:00Z', by: 'IT Operations', kind: 'status', status_to: 'in_progress', tag: 'Top-up to confirm', body: 'Credit top-up still to be confirmed; volume reduction work in progress — Operations following.' }
    ] }
];

/* TCS weekly — "Salam Digital MVNO IT Operations Managed Services · Executive Presentation", 3 Oct 2026 (week 27 Sep – 3 Oct),
 * and "Websites Performance Report — Digital" (GTmetrix, 27 Sep). Template 'tcs_mvno_weekly' (opsCockpit.js REPORT_KEYS).
 * Copied as presented; the only figure derived here is the DMS SIM-swap daily average (the deck shows the daily chart only). */
const REPORTS = [
  { seed_key: 'tcs-mvno-2026-09-27', vendor: 'TCS', segment: 'mobile', template: 'tcs_mvno_weekly', period_from: '2026-09-27', period_to: '2026-10-03',
    title: 'Salam Digital MVNO IT Operations Managed Services — weekly', created_by: 'IT Operations',
    data: {
      presented: '2026-10-03',
      availability: { apps: [{ name: 'Self Care', pct: 100 }, { name: 'Information website', pct: 100 }, { name: 'CMS', pct: 100 }], weeks: 4, outage: 'None' },
      incidents: { major: 0, note: 'No major application issue reported' },
      activation: { within30: 99.9, within30n: 2521, under60: 100, total: 2523, prevWithin30: 98.39 },
      digital: { newSim: 361, portIn: 223, simSwap: 113, prev: { newSim: 239, portIn: 153, simSwap: 89 } },
      dms: { newSim: 586, portIn: 326, simSwap: 98, note: 'SIM swap: average of the daily chart' },
      payments: { success: 94.61, delta: 0.75, functional: 5.35, technical: 0.03, successful: 68570,
        top: [['Abandoned', 2.56], ['Declined by the card issuer', 0.95], ['Insufficient funds', 0.73], ['Expired card', 0.40], ['Transaction type not supported', 0.26], ['Gateway time-out (technical)', 0.03]] },
      deployments: { total: 2, failed: 0, emergency: 0, items: [['CHG0030304', 'Selfcare deployment', 'Success'], ['CHG0030299', 'DMS UIL service deployment', 'Success']] },
      tickets: { created: 215, resolved: 218, open: 8, avgHours: 12, withinWeek: 98 },
      risks: [
        { text: 'Production database runs on a single VM — no failover', owner: 'StartAppz' },
        { text: 'No high availability for my.salammobile.sa — clone the VM, new IP, VPN ACL, add it to the load balancer, availability test', owner: 'TCS Infra · Network · Cyber Security · StartAppz' },
        { text: 'No high availability for salammobile.sa — same plan', owner: 'TCS Infra · Network · Cyber Security · StartAppz' }
      ],
      portalsDate: '2026-09-27',
      portals: [
        { site: 'my.salammobile.sa', label: 'Salam Mobile web', grade: 'D', perf: 55, structure: 67, lcp: '9.4 s', loaded: '17.6 s', size: '12.6 MB · 298 requests',
          issue: 'Enormous network payloads, chained critical requests, JavaScript execution time; no HTTP/2 or CDN' },
        { site: 'mobile.salammobile.sa', label: 'Hybrid portal', grade: 'E', perf: 37, structure: 92, lcp: '5.0 s', loaded: '5.8 s', size: '3.14 MB · 18 requests',
          issue: 'Slow server response (root document 888 ms), chained critical requests, cache policy (1.07 MB to save), long main-thread tasks' }
      ]
    } }
];

module.exports = { SEED_VERSION: 2, CAB_2026_10_07, IMPLEMENTED, UPDATES, CHALLENGES, REPORTS };
