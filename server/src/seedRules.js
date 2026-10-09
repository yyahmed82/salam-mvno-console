/* Built-in alert rules — seeded into alert_rules. Mirrors the Salam Ops
 * console rule set and extends it across the MVNO journeys/integrations.
 * operator: gt gte lt lte eq  ·  severity: P1..P4  ·  window in hours
 * active_from/active_to: KSA hours (null = always). dim: dimension filter.
 * alert_class: 'technical' | 'business' — errclass.js principle: technical = the API failed to
 * answer (timeouts/1500/715/5xx/outage/watchdog); business = the API answered "no"
 * (declines/refusals/abandonment). NO 'mixed' remains (2026-08-11): every formerly-blended rule
 * was either reclassified after examining its metric, or split into a _technical/_business pair
 * over class-filtered metric variants so each side can be enabled/disabled independently.
 * Retired keys are auto-disabled by init.js (builtin rows whose key left this list). */

const { METRICS } = require('./metrics');

const CATALOG = Object.entries(METRICS).map(([key, m]) => ({
  key, label: m.label, unit: m.unit, higher_is_bad: m.higherIsBad, source_tables: m.sourceTables
}));

const RULES = [
  // ---------- P1 : platform-wide, money-at-risk ----------
  { key: 'payment_fail_storm', name: 'Payment failure storm (P1)', severity: 'P1', team: 'Digital Ops',
    alert_class: 'business',  // gateway answered with a decline (errclass: any gateway decline = business); transport faults surface as stuck/watchdog rules instead
    metric_key: 'payment_fail_rate', operator: 'gte', threshold: 0.40, window_hours: 1, min_sample: 30,
    description: 'Card/gateway failures above 40% in the last hour — treat as a platform-wide payment incident.',
    runbook: '1) Troubleshoot → Payment/gateway: see which gateway dominates (UPG/Tap/HyperPay) and the top decline code·message. 2) One gateway failing → page that provider; spread across all → suspect our checkout/token service. 3) Use the decline drill-down for a systemic code (auth/3DS/CVV). 4) If platform-wide, open a P1 and consider pausing the failing gateway/route. 5) Page Payments L2.' },
  { key: 'payment_zatca_gap', name: 'ZATCA reporting gap (P1)', severity: 'P1', team: 'Digital Ops',
    alert_class: 'business',  // payments themselves succeeded — unreported-to-ZATCA is a compliance/business outcome, not an API failing to answer
    metric_key: 'zatca_unreported', operator: 'gte', threshold: 1500, window_hours: 3, min_sample: 0,
    description: 'Successful payments not reported to ZATCA surging past the steady backlog (~500) — e-invoicing pipeline stalling.',
    runbook: '1) Payments succeeded but are not reaching ZATCA (ClearTax) — check the e-invoicing worker/queue is running and not erroring. 2) Look for auth/cert expiry or ClearTax 5xx in logs. 3) The backlog clears once the pipeline resumes — confirm the count falls. 4) Engage the ZATCA/ClearTax integration owner if the worker is healthy but rejects persist. 5) Compliance-sensitive: keep the incident updated.' },
  { key: 'payment_stuck_storm', name: 'Payments stuck "Pending" — Tap/UPG callback failing (P1)', severity: 'P1', team: 'Digital Ops',
    alert_class: 'technical',  // gateway committed but the Tap/UPG→app callback never confirmed — the platform failed to answer
    metric_key: 'payment_stuck_initiated', operator: 'gte', threshold: 40, window_hours: 3, min_sample: 0,
    description: 'Genuinely stuck payments (gateway committed but app never finalised, >30min) surging — Tap/UPG→app confirmation (webhook) likely down: customers charged while the app shows unpaid. NOTE: this metric now counts ONLY rows with a real commit response (abandonment / "reached-page-didn\'t-continue" is excluded), so the population is small — threshold PROVISIONAL, calibrate against the live number. Authoritative paging = the Tap-confirmed mismatch metric.',
    runbook: '1) Confirm the Tap/UPG callback endpoint is up (webhook 200s). 2) In Troubleshoot → Payment stuck, grab the payment_reference_ids. 3) Reconcile each ref against Tap (CAPTURED?). 4) Replay/settle the confirmation so the app flips to success (or refund if not captured). 5) Page BSS/Payments L2 if the callback pipeline is down.' },
  { key: 'payment_stuck_spike', name: 'Payments stuck "Pending" spike (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'technical',  // same stuck-callback (platform) signal as the storm rule
    metric_key: 'payment_stuck_initiated', operator: 'gte', threshold: 15, window_hours: 3, min_sample: 0,
    description: 'Genuinely stuck payments (gateway committed, app not finalised, >30min) rising — early sign of a Tap/UPG callback / reconciliation problem. Excludes abandonment (pending with no commit response), so counts are far lower than before — threshold PROVISIONAL, calibrate against the live number.',
    runbook: '1) Early sign of the Tap-callback / reconciliation lag. 2) Troubleshoot → Payment stuck: note the trend and grab a few payment_reference_ids. 3) Spot-check them against Tap (CAPTURED but app shows unpaid?). 4) If it keeps climbing toward the P1 threshold, treat as the Tap-callback incident (see Payments stuck storm). 5) No mass action yet — watch and reconcile samples.' },
  { key: 'payment_duplicate', name: 'Duplicate charge suspected — customers deducted twice (P1)', severity: 'P1', team: 'Digital Ops',
    alert_class: 'business',  // double capture: the gateway processed (answered) twice — a charge outcome, not an outage
    metric_key: 'payment_duplicate_suspect', operator: 'gte', threshold: 25, window_hours: 6, min_sample: 0,
    description: 'SUCCESS-ONLY by definition (TKT-000018): counts groups of 2+ payments with status=success, same customer+amount+target, within 30 minutes — a fail→retry→success sequence is ONE charge and never counts. Fires when such groups surge (~3.5x the ~7/6h baseline) — suspected double deduction (UPG/Tap captured twice). Reconcile with Tap by order id; refund confirmed duplicates. Authoritative paging = the Tap-confirmed duplicate metric.',
    runbook: '1) Troubleshoot → Payment duplicate: list the customer/amount/refs. 2) In Tap, look up the order id — 2 CAPTURED charges = real duplicate. 3) Refund the extra capture; log the case. 4) If volume is rising, engage UPG/Tap on the double-capture root cause (retry/idempotency).' },
  // SPLIT 2026-08-11 (was: activation_fail_storm, alert_class 'mixed' on activation_fail_rate).
  // The old metric blended BSS platform faults with Semati refusals, forcing a 70% threshold just
  // to clear Semati's chronic ~45-55% noise. The pair below reads class-filtered variants
  // (Semati excluded, classCaseSql split), so each side is honest and independently toggleable.
  { key: 'activation_fail_storm_technical', name: 'Activation failure storm — technical/BSS faults (P1)', severity: 'P1', team: 'Digital Ops',
    alert_class: 'technical',  // 1500/5xx/408/timeouts/SOAP/OSB signatures on non-Semati activation calls — the platform failed to answer
    // PROVISIONAL — calibrate against live: 0.70 inherited from the old mixed rule (dominant class),
    // but with Semati excluded the clean baseline is near zero, so this may be far too insensitive;
    // bss_degraded (0.25) / bss_fail_burst remain the sensitive detectors meanwhile.
    metric_key: 'activation_fail_rate_technical', operator: 'gte', threshold: 0.70, window_hours: 1, min_sample: 20,
    description: 'Non-Semati activation calls failing with TECHNICAL signatures (1500 / 5xx / timeouts / SOAP faults / OSB-382000) above threshold — a platform storm, not customer refusals. Split from the old mixed activation_fail_storm; threshold PROVISIONAL — calibrate against live (the Semati noise that justified 70% is now excluded).',
    runbook: '1) Troubleshoot → Activation (BSS): identify the failing step / Oracle BSS error (status_code x api breakdown). 2) Check BSS availability and the Semati/MSISDN provisioning alerts — activation often fails downstream of Semati. 3) If BSS is up, isolate the dominant activation error code. 4) OSB read-path check: if symptoms are "plans/details not loading", greyed balance transfer, or slowness (not write failures), suspect BSS READ SOAP faults (1500 / OSB-382000) from the Siebel CNE go-live — those log in logs.uil_logs on the OSB layer (not this replica), so query it directly. 5) Page BSS / Digital Ops L2; hold retries if BSS is down to avoid a pile-up.' },
  { key: 'activation_fail_storm_business', name: 'Activation failure storm — business refusals (P1)', severity: 'P1', team: 'Digital Ops',
    alert_class: 'business',  // well-formed BSS "no"s (eligibility/policy/duplicate refusals) on non-Semati activation calls
    // PROVISIONAL — calibrate against live: set at ~half the old mixed threshold (non-dominant class).
    metric_key: 'activation_fail_rate_business', operator: 'gte', threshold: 0.35, window_hours: 1, min_sample: 20,
    description: 'Non-Semati activation calls being REFUSED (well-formed business "no"s — policy/eligibility/duplicate) above threshold. The platform is answering; customers are being turned down at an abnormal rate — a catalogue/policy/data problem rather than an outage. Split from the old mixed activation_fail_storm; threshold PROVISIONAL — calibrate against live.',
    runbook: '1) Troubleshoot → Activation (BSS): read the dominant refusal code · message — this class means BSS answered, so the message names the reason. 2) One reason dominating → suspect a catalogue/policy/config change (plan mapping, reservation, nationality data), not an outage. 3) Cross-check the technical twin rule — if BOTH are open it is one incident, treat as platform. 4) Engage the BSS functional owner / Sales Ops rather than paging infra.' },
  // ---------- BSS-only activation health (Semati excluded) — added after the 2026-08-06 miss ----------
  // On 06 Aug the BSS returned 1500s during a Cyber-Security firewall upgrade. Activation ran at 46%
  // failure on n=13 and NOTHING fired: the then-mixed activation_fail_storm needed 70% (it had to clear Semati's ~45%
  // chronic noise) AND min_sample 20. These three rules close both halves of that gap — a clean
  // baseline because Semati is excluded, and a count-based rule that works at low volume.
  // ---------- API Gateway node reachability ----------
  // The probe had NO alerting: it painted the #apigw map and nothing else, so a gateway node could
  // go down and the only way to know was for someone to open that page. INC0016809 was literally
  // titled "Digital Channel Alerts Observed – API GW Failures".
  { key: 'apigw_node_down', name: 'API Gateway node unreachable (P1)', severity: 'P1', team: 'Digital Ops',
    alert_class: 'technical',  // TCP reachability probe — pure infrastructure
    metric_key: 'apigw_nodes_unreachable', operator: 'gte', threshold: 1, window_hours: 0.25, min_sample: 1,
    description: 'A gateway node that WAS reachable from the console has stopped answering on TCP. Baseline-relative by design — nodes never opened to this host (172.31.42.23/.24 at the time of writing) are excluded, so this only fires on a real change. A node dropping out means traffic is being carried by fewer gateways than you think, and the survivors mask it in aggregate success rates.',
    runbook: '1) Open #apigw for the node map and see which node(s) went dark and when. 2) refused = host alive but nothing listening (service stopped/restarted); timeout = no route back (firewall/routing change). The distinction tells you who to call. 3) Ask whether a network or firewall change landed — INC0016809 (06 Aug) was a Cyber-Security firewall upgrade, CRQ000000190352, and broke SOAP transport within 30 min of completing. 4) Check the BSS alerts: if bss_soap_fault_1500 or bss_degraded is also open, this is one upstream fault, not two. 5) Aggregate success rates can look fine while a node is dead — do not close on "the dashboard is green". 6) Page Digital Ops L2 / MVNO Infra.' },

  { key: 'bss_soap_fault_1500', name: 'BSS SOAP fault 1500 — write path (P1)', severity: 'P1', team: 'Digital Ops',
    alert_class: 'technical',  // SOAP Fault where a response was expected = BSS failed to answer (errclass code 1500)
    metric_key: 'bss_soap_fault', operator: 'gte', threshold: 5, window_hours: 0.5, min_sample: 0,
    description: 'BSS is returning SOAP Faults where a transaction response was expected — responseCode 1500, "unexpected XML tag … but found: Fault" on createSubscriptionTransaction. This is the INC0016809 signature (06 Aug 2026): a Cyber-Security firewall upgrade, CRQ000000190352, completed 05:00 KSA broke the SOAP path 172.20.10.194 → 172.20.8.56. NEVER normal — five in 30 min is an incident at any traffic volume. NOTE: this is the WRITE path (visible here). The READ-path 1500 / OSB-382000 on list-invoices / get-account is a different fault that lives in logs.uil_logs and still needs the OSB feed.',
    runbook: '1) Troubleshoot → Activation (BSS): confirm the api and read a full response body — "unexpected XML tag … expected createSubscriptionTransactionResponse but found Fault" means BSS answered with a SOAP Fault, not that our request was malformed. 2) Ask whether a network or firewall change landed in the last hour — INC0016809 was caused by a firewall upgrade and reproduced within 30 min of the activity completing. Get the CRQ number. 3) Check whether BRM/BSS components were restarted; intermittent recovery after a restart points at transport, not application logic. 4) Blast radius: activation, plan renew, and login — say so explicitly in the incident, because the BSS-side view may show "no errors in the last few minutes" while customers are still failing. 5) Page Digital Ops L2 and join the MIM bridge; this is a P1 by precedent.' },
  { key: 'bss_degraded', name: 'BSS activation degraded (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'technical',  // BSS write-path failures with Semati excluded — platform-fault baseline
    metric_key: 'bss_write_fail_rate', operator: 'gte', threshold: 0.25, window_hours: 1, min_sample: 8,
    description: 'BSS activation calls failing ≥25% in the last hour, with Semati calls excluded so the chronic ~45% Semati noise cannot mask or inflate this. A clean BSS baseline sits near zero — 25% is already a real fault. Signature of the 2026-08-06 firewall-upgrade incident (46% on n=13).',
    runbook: '1) Troubleshoot → Activation (BSS): read the api × status_code breakdown — one dominant code means an upstream fault, scattered codes mean per-customer errors. 2) Ask the IMPACT/BSS team whether a change is in flight (firewall, Siebel deploy, OSB restart) — on 06 Aug the cause was a Cyber-Security firewall upgrade. 3) If symptoms are reads ("plans/details not loading", greyed balance transfer, slowness) rather than write failures, this is the OSB read-path 1500 / OSB-382000 path — those live in logs.uil_logs and need the OSB feed (OSB_LOG_URL); query that DB directly until it is wired up. 4) Check the Semati alerts separately — if they are also open, the shared upstream is the story. 5) Page Digital Ops L2.' },
  { key: 'bss_fail_burst', name: 'BSS activation failures burst — low volume (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'technical',  // count of BSS platform failures (Semati excluded)
    metric_key: 'bss_fail_burst', operator: 'gte', threshold: 6, window_hours: 0.5, min_sample: 0,
    description: 'Six or more BSS activation failures in 30 min (Semati excluded). Deliberately COUNT-based, not rate-based: at quiet hours the denominator is tiny (n=13 at 07:00 KSA on 06 Aug), so every rate rule sits the incident out. A count has no denominator to be starved of.',
    runbook: '1) Troubleshoot → Activation (BSS): identify which api and which status_code. 2) Cross-check the BSS degraded alert — if both are open, it is broad; if only this one, it may be a single failing endpoint. 3) Confirm with the IMPACT/BSS team whether a change is in flight. 4) If reads are the symptom, follow the OSB 1500 path (logs.uil_logs). 5) Low volume does NOT mean low impact — at 07:00 KSA six failures can be most of the traffic.' },
  { key: 'bss_error_dominant', name: 'One BSS error code dominating (P3)', severity: 'P3', team: 'Digital Ops',
    alert_class: 'technical',  // one code dominating = upstream-fault fingerprint (the code itself can be business, but the rule hunts platform faults)
    metric_key: 'bss_top_error_share', operator: 'gte', threshold: 0.60, window_hours: 1, min_sample: 5,
    description: 'A single error code accounts for ≥60% of BSS activation failures in the hour (needs at least 5 failures). Scattered codes are ordinary per-customer errors; one code dominating is the fingerprint of an upstream fault — a firewall change, an OSB timeout, a Siebel deploy. The code is carried in the alert dimension.',
    runbook: '1) Read the code from the alert dimension, then Troubleshoot → Activation (BSS) for the api it is hitting. 2) Look it up: 00/600 = ok, 7xx/8xx = Semati-family, 1500 = OSB SOAP fault (read path). 3) Ask IMPACT/BSS what changed in the last hour. 4) This is an early-warning P3 — if the rate or burst rules also open, escalate to their severity.' },

  { key: 'semati_fail_storm', name: 'Semati provisioning storm (P1)', severity: 'P1', team: 'Digital Ops',
    alert_class: 'business',  // semati_fail_rate now measures ONLY provisioning refusals — 715/transport rows are excluded and live in the technical Semati rules
    metric_key: 'semati_fail_rate', operator: 'gte', threshold: 0.75, window_hours: 1, min_sample: 20,
    description: 'MSISDN provisioning failing well above the ~55% baseline (SEMATI_FAILED / MOBILE_EXISTS) — real deterioration.',
    runbook: '1) Troubleshoot → Semati: separate provider errors (715 / transport — see the Semati provider alerts) from business failures (MOBILE_EXISTS / SEMATI_FAILED). 2) 715/transport dominate → provider-down path (contact TCC). 3) MOBILE_EXISTS dominates → number-pool / duplicate issue, not an outage. 4) Correlate with the CITC composite alert. 5) Page Digital Ops L2.' },
  { key: 'nafath_fail_storm', name: 'Nafath abandonment storm (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'business',  // EXPIRED/REJECTED/DENIED are well-formed \"no\"s from Nafath (errclass BIZ_TEXT)
    metric_key: 'nafath_fail_rate', operator: 'gte', threshold: 0.55, window_hours: 1, min_sample: 40,
    description: 'Identity verification (Nafath) failing above 50% within the hour — blocks new-line onboarding; page on-call.',
    runbook: '1) Troubleshoot → Nafath/identity: confirm the failure type (timeout, rejected, provider 5xx). 2) Check the CITC composite alert — if Semati is also breaching, it is a shared CITC/Absher upstream issue. 3) If Nafath-only, verify our IAM/Absher integration (token/cert). 4) Nafath gates new-line onboarding — open a P1 and page on-call.' },

  // ---------- P1 : Semati (TCC) provider connectivity — incident #28713 ----------
  { key: 'semati_provider_down', name: 'Semati provider unreachable (715 / connection reset) (P1)', severity: 'P1', team: 'Digital Ops',
    alert_class: 'technical',  // 715 / transport = the provider failed to answer
    metric_key: 'semati_provider_error_rate', operator: 'gte', threshold: 0.50, window_hours: 0.25, min_sample: 8,
    description: 'Over half of Semati calls in the last 15 min are returning 715 "Service is not available" or transport errors (Connection reset / SSLException / HTTP 408) — the TCC provider is down or unreachable. Blocks eligibility + activation. Same signature as #28713.',
    runbook: '1) Troubleshoot → Semati: confirm the codes — 715 = provider app refusing ("Service Not Available"); 5002/408/Connection reset = transport/TLS. Intermittent 715 is the #28713 / #28812 / #28875 (INC0013148) signature — shows in ELIGIBILITY and ACTIVATION. 2) RECURRING (multiple P1s within a week): TCC RCA is a "global network issue at their end" with no permanent fix yet — treat as a known upstream instability and cite the recurrence when escalating. 3) Check the CITC composite alert — if Nafath is also breaching, it is a shared TCC/CITC upstream issue (not our side). 4) Contact TCC Customer Success (customersuccess@tcc-ict.com, +966920003604) — the PRIMARY TCC channel (Semati Support retiring); if the portal is unreachable, email them directly and open the P-ticket. 5) If transport-only: check our egress/DNS/TLS to semati.tcc-ict.com (login + eligibility/v2). 6) Blast radius: blocks Activation, MNP, Eligibility, Change Plan and SIM Swap — flag all. Page Digital Ops L2; open the alert History to show TCC how often this has recurred.' },
  { key: 'semati_login_down', name: 'Semati login endpoint down — gates everything (P1)', severity: 'P1', team: 'Digital Ops',
    alert_class: 'technical',  // same 715/transport outage signature, scoped to login
    metric_key: 'semati_provider_error_rate', operator: 'gte', threshold: 0.50, window_hours: 0.25, min_sample: 5,
    dim: { endpoint: 'login' },
    description: 'The Semati login endpoint is failing ≥50% in the last 15 min. Login gates every downstream Semati call (eligibility/provisioning), so this is the earliest hard-impact signal — treat as provider-down even if eligibility still shows some success.',
    runbook: '1) Login gates every downstream Semati call — treat as provider-down. 2) Troubleshoot → Semati: confirm login 715/transport codes. 3) Distinguish credentials rejected (auth) vs endpoint unreachable (transport) to semati.tcc-ict.com. 4) Contact TCC Customer Success (customersuccess@tcc-ict.com, +966920003604); page Digital Ops L2.' },
  { key: 'semati_eligibility_down', name: 'Semati eligibility endpoint down (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'technical',  // same 715/transport outage signature, scoped to eligibility
    metric_key: 'semati_provider_error_rate', operator: 'gte', threshold: 0.50, window_hours: 0.25, min_sample: 5,
    dim: { endpoint: 'eligibility' },
    description: 'The Semati ELIGIBILITY endpoint is failing ≥50% in the last 15 min (715 / transport) — eligibility checks blocked, which gates new-SIM and MNP. This is exactly where INC0012977 surfaced. Fires on its own when only eligibility is hit; grouped under provider-down when the whole provider is out.',
    runbook: '1) Troubleshoot → Semati (eligibility endpoint): confirm 715 "Service Not Available". 2) Correlate with the provider-down / CITC composite alert. 3) Contact TCC Customer Success (customersuccess@tcc-ict.com, +966920003604) — Semati Support is being retired. 4) Blocks Eligibility → Activation / MNP; flag the blast radius.' },
  { key: 'semati_hard_down', name: 'Semati zero-success watchdog (P1)', severity: 'P1', team: 'Digital Ops',
    alert_class: 'technical',  // zero-success watchdog = hard outage
    metric_key: 'semati_success_volume', operator: 'lte', threshold: 0, window_hours: 1, min_sample: 20,
    description: 'Semati was called ≥20 times in the last hour with zero successes — a hard outage. Fires even when a percentage looks noisy; the min-sample gate keeps it quiet when there is genuinely no traffic.',
    runbook: '1) Zero Semati successes with real traffic = hard outage. 2) Follow the Semati provider-unreachable runbook: confirm 715/transport codes, check the CITC composite, contact TCC. 3) Zero-success means do not wait for percentages — page on-call now.' },

  // ---------- P1/P2 : per-gateway zero-success watchdogs — INC0014859 ----------
  // A single gateway going dark hides from blended payment metrics: when UPG dropped, traffic
  // auto-failed-over to HyperPay so blended fail-rate/volume stayed healthy (Business Impact = "No")
  // while UPG produced zero successes. These fire off gateway_success_volume, whose sample is the
  // TOTAL platform successes — so they fire only when the platform is clearly live yet this one
  // gateway is silent, exactly like the ServiceNow "UPG Payment Graph – No Success" monitor.
  { key: 'upg_hard_down', name: 'UPG gateway zero-success watchdog (P1)', severity: 'P1', team: 'Digital Ops',
    alert_class: 'technical',  // per-gateway zero-success watchdog = gateway outage
    metric_key: 'gateway_success_volume', operator: 'lte', threshold: 0, window_hours: 0.5, min_sample: 15,
    dim: { gateway: 'UPG' },
    description: 'UPG (SalamPay/Merchalink) produced ZERO successful payments in the last 30 min while ≥15 payments succeeded platform-wide — a UPG outage masked by HyperPay failover. This is the INC0014859 signature: blended fail-rate stays green because traffic reroutes to HyperPay, so this per-gateway watchdog is the only console signal that a single gateway is down. Mirrors the ServiceNow "UPG Payment Graph – No Success" alert.',
    runbook: '1) Confirm UPG is the silent gateway: Troubleshoot → Payment, filter gateway = UPG, and check the gateway breakdown — UPG success should be ~0 while HyperPay picks up. 2) If HyperPay is absorbing traffic, customer impact is likely low (auto-failover) but UPG is still DOWN — treat as a real P1 on the gateway. 3) Contact UPG/SalamPay (Merchalink) — this class of outage has been network-related on the UPG platform (per INC0014859). 4) Verify failover is actually holding (blended payment_fail_rate green, HyperPay volume up); if failover is NOT holding, escalate immediately — checkout is impaired. 5) Watch gateway_success_volume for UPG to recover before closing.' },
  { key: 'hyperpay_hard_down', name: 'HyperPay gateway zero-success watchdog (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'technical',  // per-gateway zero-success watchdog = gateway outage
    metric_key: 'gateway_success_volume', operator: 'lte', threshold: 0, window_hours: 0.5, min_sample: 30,
    dim: { gateway: 'HyperPay' },
    description: 'HyperPay produced ZERO successful payments in the last 30 min while ≥15 payments succeeded platform-wide — a HyperPay outage. HyperPay is the failover target for UPG, so if HyperPay is the one down, a subsequent UPG blip would have no cushion — worth catching early.',
    runbook: '1) Troubleshoot → Payment, filter gateway = HyperPay; confirm ~0 HyperPay successes while other gateways process. 2) HyperPay is the UPG failover target — if it is down, the platform has no cushion for a UPG blip; flag that risk. 3) Contact HyperPay support. 4) Watch for recovery on gateway_success_volume.' },
  { key: 'tap_hard_down', name: 'Tap gateway zero-success watchdog (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'technical',  // per-gateway zero-success watchdog = gateway outage
    metric_key: 'gateway_success_volume', operator: 'lte', threshold: 0, window_hours: 3, min_sample: 30,
    dim: { gateway: 'Tap' },
    description: 'Tap produced ZERO successful payments in the last 30 min while ≥20 payments succeeded platform-wide — a Tap outage. Pairs with the existing Tap-callback / stuck-payment alerts (which catch confirmations failing); this one catches Tap producing no successes at all.',
    runbook: '1) Troubleshoot → Payment, filter gateway = Tap; confirm ~0 Tap successes with the platform otherwise live. 2) Cross-check the Tap-callback / payments-stuck alerts — a callback outage and a hard-down look different (stuck vs zero-success). 3) Contact Tap support; reconcile any Initiated/stuck payments. 4) Watch gateway_success_volume for Tap to recover.' },
  // COMPOSITE SPLIT 2026-08-11 (was: citc_upstream_down, alert_class 'mixed' on the
  // citc_upstream_degraded LEAST(semati,nafath) composite). The composite blended Semati
  // 715/transport (technical) with Nafath refusal outcomes (business). Split into two rules over
  // the EXISTING single-class metrics; the old "both at once = shared CITC upstream" reading is
  // preserved by the correlation module grouping them, and each side toggles independently.
  // Old composite required BOTH sides ≥0.40, so each half keeps 0.40 (faithful split, not halved).
  { key: 'citc_upstream_down_technical', name: 'CITC upstream degraded — Semati side (P1)', severity: 'P1', team: 'Digital Ops',
    alert_class: 'technical',  // Semati 715 / transport share — the provider failed to answer
    // PROVISIONAL — calibrate against live: inherits the composite's 0.40; the LEAST() gating is
    // gone, so this now fires on Semati alone (semati_provider_down at 0.50/15min stays the primary).
    metric_key: 'semati_provider_error_rate', operator: 'gte', threshold: 0.40, window_hours: 0.5, min_sample: 10,
    description: 'Semati provider errors (715 / transport) ≥40% over 30 min — the Semati half of the old CITC composite. If the Nafath twin (citc_upstream_down_business) is open at the same time, the shared TCC/CITC path is degraded: provider-side, not ours — one incident, not per-endpoint pages.',
    runbook: '1) Check the Nafath twin rule — BOTH open = shared TCC/CITC upstream, almost certainly not the DMS. 2) Confirm with TCC Customer Success (customersuccess@tcc-ict.com) — ask if a restart/maintenance is in progress on the source. 3) Post a single incident + status update; do not chase each endpoint separately. 4) Watch for recovery on both providers before closing.' },
  { key: 'citc_upstream_down_business', name: 'Nafath verification abandonment high (P3)', severity: 'P3', team: 'Digital Ops',
    alert_class: 'business',  // Nafath EXPIRED/REJECTED/DENIED — well-formed refusal outcomes
    // PROVISIONAL — calibrate against live: inherits the composite's 0.40 (between nafath_fail_spike
    // 0.25 and nafath_fail_storm 0.50, but on a 30-min window).
    metric_key: 'nafath_fail_rate', operator: 'gte', threshold: 0.60, window_hours: 0.5, min_sample: 25,
    description: 'Nafath verification failing ≥40% over 30 min — the Nafath half of the old CITC composite. If the Semati twin (citc_upstream_down_technical) is open at the same time, the shared TCC/CITC path is degraded: provider-side, not ours — one incident, not per-endpoint pages.',
    runbook: '1) Check the Semati twin rule — BOTH open = shared TCC/CITC upstream, almost certainly not the DMS. 2) If Nafath-only, verify our IAM/Absher integration (token/cert) and the failure type (expired vs rejected). 3) Confirm with TCC Customer Success (customersuccess@tcc-ict.com) if upstream. 4) Watch for recovery before closing.' },

  // ---------- P2 : degradations ----------
  { key: 'semati_provider_degraded', name: 'Semati provider errors rising (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'technical',  // 715/transport error share rising — provider/platform layer
    metric_key: 'semati_provider_error_rate', operator: 'gte', threshold: 0.20, window_hours: 0.5, min_sample: 15,
    description: 'Semati 715 / transport errors ≥20% over 30 min — early degradation before a full outage. Watch for it climbing toward the P1 threshold.',
    runbook: '1) Early Semati degradation (715/transport 20–50%). 2) Troubleshoot → Semati: watch the error-rate trend — if it climbs toward 50% it escalates to the provider-down P1. 3) Pre-warn TCC if the trend is steep. 4) No mass action yet.' },
  { key: 'semati_transport_errors', name: 'Semati transport/TLS errors (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'technical',  // transport/TLS layer by definition
    metric_key: 'semati_transport_error_rate', operator: 'gte', threshold: 0.15, window_hours: 0.5, min_sample: 10,
    description: 'Connection reset / SSLException / HTTP 408 to Semati ≥15% over 30 min — points at network/TLS/provider-infra rather than the provider app (distinct from 715).',
    runbook: '1) Transport-layer, not app: check DNS + TLS handshake + egress firewall to semati.tcc-ict.com (login and /TCC-Web/api/eligibility/v2). 2) If broad across providers, suspect our egress/proxy; if Semati-only, provider infra. 3) Correlate with the timeout (408) count for the leading edge.' },
  { key: 'semati_flapping', name: 'Semati flapping (intermittent) (P3)', severity: 'P3', team: 'Digital Ops',
    // RECLASSIFIED 2026-08-11 (was 'mixed'): the pattern this rule hunts is success ↔ 715 "Service
    // Not Available" — provider instability, i.e. TECHNICAL. The metric was tightened to match: it
    // now counts only flips INTO a 715/transport row (flips into business refusals like
    // MOBILE_EXISTS are chronic provisioning noise and are excluded), so the class is honest.
    alert_class: 'technical',
    // Threshold 6 kept, but PROVISIONAL — calibrate against live: business-refusal flips no longer count.
    metric_key: 'semati_flapping', operator: 'gte', threshold: 8, window_hours: 0.5, min_sample: 20,
    description: '≥6 ok→provider-error transitions in 30 min — Semati is returning success and 715 "Service Not Available" / transport errors intermittently. This is the pattern a flat failure-rate threshold misses. Threshold PROVISIONAL — calibrate against live (metric now excludes flips into business refusals).',
    runbook: '1) Semati is flapping (success ↔ "Service Not Available") — usually provider instability or one load-balanced node failing. 2) Troubleshoot → Semati: confirm the ok↔fail pattern. 3) Flag to TCC as intermittent (harder for them to spot than a hard down). 4) Expect user-visible retries; watch for it hardening into a full outage.' },

  // ---------- P3 : watch ----------
  { key: 'semati_timeouts', name: 'Semati timeouts (HTTP 408) rising (P3)', severity: 'P3', team: 'Digital Ops',
    alert_class: 'technical',  // HTTP 408 timeouts — the API failed to answer in time
    metric_key: 'semati_timeout_count', operator: 'gte', threshold: 15, window_hours: 0.5, min_sample: 0,
    description: 'HTTP 408 timeouts to Semati climbing — latency is rising and usually precedes connection resets. Early warning; escalates to the provider-error P1 if it continues.',
    runbook: '1) 408 timeouts to Semati rising — latency creeping up, often precedes connection resets. 2) Troubleshoot → Semati: watch the 408 count. 3) Early warning only; if it continues it escalates to the provider-error P1. 4) Note it on any open TCC thread.' },

  // ---------- P2 : degradations (journeys) ----------
  { key: 'payment_fail_spike', name: 'Payment failure spike (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'business',  // decline-rate: the gateway answered \"no\"
    metric_key: 'payment_fail_rate', operator: 'gte', threshold: 0.55, window_hours: 3, min_sample: 40,
    description: 'Payment failure rate elevated above the ~19% baseline over 3h (early degradation).',
    runbook: '1) Payment failures elevated over 3h — early degradation, not yet a storm. 2) Troubleshoot → Payment: check the leading gateway and top decline code. 3) Watch for it crossing the P1 storm threshold. 4) Sample a few declines to rule out a systemic code.' },
  { key: 'payment_web_fail', name: 'Web checkout failure spike (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'business',  // web decline-rate — gateway answered \"no\"
    metric_key: 'payment_fail_rate', operator: 'gte', threshold: 0.60, window_hours: 3, min_sample: 50,
    dim: { platform: 'web' }, description: 'Epurchase payment failures elevated — isolate from app.',
    runbook: '1) Web checkout failures elevated (isolated from app). 2) Troubleshoot → Payment, filter platform=web: check the web gateway / 3DS redirect flow. 3) Compare with the app failure rate — if app is healthy, it is a web-checkout/redirect issue. 4) Engage the web/checkout owner.' },
  { key: 'nafath_fail_spike', name: 'Nafath abandonment rising (P3)', severity: 'P3', team: 'Digital Ops',
    alert_class: 'business',  // Nafath refusal outcomes (expired/rejected)
    metric_key: 'nafath_fail_rate', operator: 'gte', threshold: 0.40, window_hours: 1, min_sample: 40,
    description: 'Identity verification (Nafath) failing ≥25% in the last hour — early degradation on the onboarding-critical path.',
    runbook: '1) Nafath failing ≥25%/1h — early degradation on the onboarding path. 2) Troubleshoot → Nafath: confirm the failure type. 3) Watch toward the 50% storm threshold; correlate with the CITC composite. 4) Pre-warn the IAM/Absher owner if it is climbing.' },
  { key: 'semati_fail_spike', name: 'Semati provisioning failure spike (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'business',  // provisioning refusals (MOBILE_EXISTS / SEMATI_FAILED); 715/transport excluded from the metric
    metric_key: 'semati_fail_rate', operator: 'gte', threshold: 0.65, window_hours: 24, min_sample: 20,
    description: 'MSISDN provisioning failing above the ~55% baseline — SEMATI_FAILED / MOBILE_EXISTS.',
    runbook: '1) Semati provisioning above baseline over 24h — mostly MOBILE_EXISTS / SEMATI_FAILED business failures. 2) Troubleshoot → Semati: confirm it is business (not 715/transport). 3) If MOBILE_EXISTS dominates, review the number pool / duplicate-order logic. 4) Not a provider outage unless the Semati provider alerts also fire.' },
  { key: 'eligibility_deny_spike', name: 'Eligibility denials (P2)', severity: 'P2', team: 'Sales Ops',
    alert_class: 'business',  // CITC answered DENIED — provider errors are already excluded from the metric
    metric_key: 'eligibility_deny_rate', operator: 'gte', threshold: 0.59, window_hours: 24, min_sample: 50,
    description: 'CITC eligibility DENIED above the ~37% baseline (real spike, not the chronic denial level).',
    runbook: '1) Troubleshoot → Eligibility: check the denial reasons — legitimate CITC policy (max lines / ID) vs a systemic error. 2) If one reason surges, engage the CITC/eligibility owner. 3) Sales Ops to review whether genuine customers are affected. 4) Distinguish from a Semati provider outage (that path shows 715/transport, not DENIED).' },
  // SPLIT 2026-08-11 (was: change_plan_fail_spike, alert_class 'mixed'). change_plan_logs carries
  // the real error text in final_step_message ("Failed, Net::ReadTimeout…", "Failed, Error 16 -
  // Unable to update Subscription…"), so the metric was split with classCaseSql rather than guessed.
  { key: 'change_plan_fail_spike_technical', name: 'Change Plan failure spike — technical/BSS faults (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'technical',  // timeouts / SOAP / transport signatures in final_step_message — BSS failed to answer
    // PROVISIONAL — calibrate against live: 0.30 inherited from the old mixed rule (dominant class:
    // the runbook's target was the BSS plan-migration fault).
    metric_key: 'change_plan_fail_rate_technical', operator: 'gte', threshold: 0.30, window_hours: 24, min_sample: 15,
    description: 'Prepaid↔postpaid / plan migration failing with TECHNICAL signatures (timeouts / SOAP / transport in final_step_message) above threshold — the BSS plan-change path is faulting. Split from the old mixed change_plan_fail_spike; threshold PROVISIONAL — calibrate against live.',
    runbook: '1) Troubleshoot → Change Plan: identify the BSS error on the plan-migration API. 2) Check BSS availability and the specific change-plan endpoint. 3) Engage BSS L2 if systemic. 4) Note whether it is prepaid→postpaid or the reverse to narrow the failing flow.' },
  { key: 'change_plan_fail_spike_business', name: 'Change Plan failure spike — business refusals (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'business',  // well-formed refusals in final_step_message (policy/eligibility/data "no"s — BSS answered)
    // PROVISIONAL — calibrate against live: ~half the old mixed threshold (non-dominant class).
    metric_key: 'change_plan_fail_rate_business', operator: 'gte', threshold: 0.15, window_hours: 24, min_sample: 15,
    description: 'Plan migrations being REFUSED (well-formed "no"s in final_step_message — policy / eligibility / customer-data reasons, e.g. "Customer nationality returned empty from BSS") above threshold. BSS is answering; the refusal reason is the story. Split from the old mixed change_plan_fail_spike; threshold PROVISIONAL — calibrate against live.',
    runbook: '1) Troubleshoot → Change Plan: read the dominant final_step_message — this class means BSS answered with a reason. 2) One reason dominating → catalogue/policy/data issue (plan mapping, nationality data), not an outage. 3) Cross-check the technical twin — both open = one platform incident. 4) Engage the plans/catalogue owner rather than BSS infra.' },
  { key: 'delivery_fail_spike', name: 'Delivery failure/return spike (P2)', severity: 'P2', team: 'Digital Ops',
    // RECLASSIFIED 2026-08-11 (was 'mixed'): delivery_fail_rate counts the cancelled/refused/
    // returned/RTO state lists — every one is a WELL-FORMED outcome the courier reported back
    // (customer refused, address failed, shipment returned). The platform answered; these are
    // delivery OUTCOMES, not transport faults → business per the errclass principle. The technical
    // side of delivery (callbacks never arriving, dispatch never created) is already covered by
    // delivery_stuck / courier_backlog_* which are class 'technical'.
    alert_class: 'business',
    metric_key: 'delivery_fail_rate', operator: 'gte', threshold: 0.25, window_hours: 24, min_sample: 20,
    description: 'Courier returns/failures elevated across vendors.',
    runbook: '1) Troubleshoot → Delivery: see which courier(s) dominate (SMSA/OTO/Barq/iMile/etc.). 2) One courier → contact that vendor; all couriers → suspect address/data quality or our delivery feed. 3) Engage the logistics owner. 4) Check returns vs outright failures to target the fix.' },
  { key: 'delivery_stuck', name: 'Deliveries stuck in transit (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'technical',  // courier status callbacks never arrived — stuck-platform signal
    metric_key: 'delivery_stuck', operator: 'gte', threshold: 60000, window_hours: 48, min_sample: 0,
    description: 'Stuck-shipment backlog growing past the steady ~51k (in-transit states never finalised) — investigate courier callbacks.',
    runbook: '1) In-transit shipments not finalising (backlog past ~51k). 2) Troubleshoot → Delivery: check for missing courier status callbacks. 3) If a courier stopped sending updates, chase that vendor webhook/feed. 4) Reconcile stuck shipments before assuming they are lost.' },
  // Reseller (tygo/soob) courier NEVER dispatched: paid, physical, apollo_require_delivery≠false, but
  // no delivery_requests row after the grace window. commit_worker uses the SAME oto/tam carriers for
  // resellers, so a missing row is a dispatch failure, not shop pickup. window_hours = grace age (only
  // orders older than this count → excludes freshly-paid in-flight). Live physical baseline = 0
  // (2026-08-10; the earlier "106" was eSIM-inflated — eSIM needs no courier, so the metric filters it
  // out). Thresholds set just above a zero baseline (P2≥5 early, P1≥15 outage) — recalibrate if the
  // steady-state courier_backlog turns out to be routinely non-zero.
  { key: 'courier_backlog_storm', name: 'Reseller courier not dispatched — surge (P1)', severity: 'P1', team: 'Digital Ops',
    alert_class: 'technical',  // DeliveryManager not creating courier requests — platform dispatch failure
    metric_key: 'courier_backlog', operator: 'gte', threshold: 15, window_hours: 0.5, min_sample: 0,
    description: 'Paid tygo/soob orders that required courier delivery (apollo_require_delivery≠false) but have NO delivery_requests row after 30min are surging — DeliveryManager is not creating courier requests for resellers (same oto/tam path as everyone). Customers paid and will never receive a SIM. Threshold PROVISIONAL — calibrate against the live courier_backlog value.',
    runbook: '1) Dashboard → order tree → Courier not created box: hover to see which reseller (tygo/soob) is backed up. 2) Confirm on the replica: paid + apollo_require_delivery≠false + no delivery_requests row. 3) Check the payment→commit worker (commit_worker.rb DeliveryManager.create_from_order) and the reseller checkout confirm path — is the commit worker running / erroring? 4) If a reseller integration stopped calling confirm, chase that partner. 5) Re-drive delivery creation for the stuck orders once the path is restored; verify the box falls.' },
  { key: 'courier_backlog_spike', name: 'Reseller courier not dispatched — rising (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'technical',  // same dispatch-path (platform) signal as the storm rule
    metric_key: 'courier_backlog', operator: 'gte', threshold: 5, window_hours: 0.5, min_sample: 0,
    description: 'Paid reseller (tygo/soob) orders needing courier but with no delivery request after 30min are climbing — early sign the reseller courier-dispatch path is degrading. Threshold PROVISIONAL — calibrate against the live courier_backlog value.',
    runbook: '1) Watch the Courier not created box trend and note which reseller. 2) Spot-check a few orders on the replica (paid, courier required, no delivery row). 3) If it keeps climbing toward the P1 threshold, treat as the courier-dispatch incident. 4) No mass action yet — confirm the commit/confirm path and reconcile samples.' },
  { key: 'samsung_pay_down', name: 'Samsung Pay failing — new method (P1)', severity: 'P1', team: 'Digital Ops',
    alert_class: 'business',  // decline-rate on the Samsung Pay rail — gateway answered; hard transport failure shows up as stuck/watchdog rules
    metric_key: 'samsung_pay_fail_rate', operator: 'gte', threshold: 0.60, window_hours: 1, min_sample: 8,
    description: 'Samsung Pay (launched recently) failing ≥60% in the last hour — a launch regression or a UPG-side Samsung Pay outage. Small min-sample because volume is still ramping.',
    runbook: '1) Troubleshoot → Payment, filter to Samsung Pay (payment_method/vendor ~ samsung): read the gateway code · message from the decline breakdown. 2) If one gateway code dominates, it is UPG/Samsung-Pay side — correlate the payment_reference_id against UPG (payment_commit_response.gateway.response). 3) Compare with card/mada success in the same window — if only Samsung Pay is failing, isolate to the Samsung Pay rail. 4) Engage Payments L2 / the Samsung Pay integration owner; consider hiding the Samsung Pay option if it is hard-down.' },
  { key: 'samsung_pay_fail_spike', name: 'Samsung Pay failure spike (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'business',  // same Samsung Pay decline-rate
    metric_key: 'samsung_pay_fail_rate', operator: 'gte', threshold: 0.25, window_hours: 6, min_sample: 10,
    description: 'Samsung Pay failures elevated over 6h — early degradation on the new method before it becomes a full outage.',
    runbook: '1) Troubleshoot → Payment, Samsung Pay: check the leading gateway code · message. 2) Watch the trend toward the P1 threshold. 3) Sample a few declines to tell a customer-side cause (e.g. tokenisation/3DS) from a UPG-side one. 4) Pre-warn the Samsung Pay integration owner if it is climbing.' },
  // SPLIT 2026-08-11 (was: ownership_fail_spike, alert_class 'mixed'). Same change_plan_logs
  // final_step_message split as change_plan_fail_spike, scoped to checkout_type=5: Nafath
  // transfer_ownership refusals / policy "no"s classify business, BSS plan-change faults technical.
  { key: 'ownership_fail_spike_technical', name: 'Change-Ownership failure spike — technical/BSS faults (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'technical',  // timeouts / SOAP / transport signatures on the ownership plan-change step
    // PROVISIONAL — calibrate against live: 0.30 inherited from the old mixed rule (dominant class:
    // the plan-change step this metric measures fails on the BSS side).
    metric_key: 'ownership_fail_rate_technical', operator: 'gte', threshold: 0.30, window_hours: 24, min_sample: 10,
    description: 'Ownership-transfer (checkout_type 5) plan-change step failing with TECHNICAL signatures (timeouts / SOAP / transport) above threshold — the BSS side of number transfer is faulting. Split from the old mixed ownership_fail_spike; threshold PROVISIONAL — calibrate against live.',
    runbook: '1) Troubleshoot → Change Ownership: open a failing case and read its detail. 2) This class = the BSS plan-change for the new owner is faulting — check BSS availability and the change-plan API. 3) Cross-check the business twin — both open = one incident. 4) Escalate to Digital Ops L2 if systemic.' },
  { key: 'ownership_fail_spike_business', name: 'Change-Ownership failure spike — business refusals (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'business',  // well-formed refusals (Nafath transfer_ownership authorize "no"s / policy reasons)
    // PROVISIONAL — calibrate against live: ~half the old mixed threshold (non-dominant class).
    metric_key: 'ownership_fail_rate_business', operator: 'gte', threshold: 0.15, window_hours: 24, min_sample: 10,
    description: 'Ownership transfers being REFUSED (well-formed "no"s — Nafath transfer_ownership authorize rejections / policy reasons) above threshold. The platform is answering; transfers are being turned down. Split from the old mixed ownership_fail_spike; threshold PROVISIONAL — calibrate against live.',
    runbook: '1) Troubleshoot → Change Ownership: read the refusal detail — this class means the step answered with a reason. 2) Nafath transfer_ownership authorize rejections dominating → check the identity path and whether customers are declining/expiring the authorize. 3) Policy reasons → engage the ownership-flow owner. 4) Cross-check the technical twin before escalating to L2.' },
  { key: 'recharge_fail_spike', name: 'Recharge / renewal failure spike (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'business',  // renewal payment declines — gateway answered \"no\"
    metric_key: 'recharge_fail_rate', operator: 'gte', threshold: 0.55, window_hours: 3, min_sample: 40,
    description: 'Plan renewal / recharge payments (checkout_type 6) failing above threshold over 3h — existing customers cannot top up / renew.',
    runbook: '1) Troubleshoot → Payment: filter to the renewal flow and check the leading gateway + top decline code. 2) Compare with the overall payment failure rate — renewal-only spike points at the renewal checkout/plan, not all payments. 3) Check the renewal plan catalogue / pricing service if declines are systemic. 4) Escalate to Payments/BSS L2.' },
  { key: 'courier_partner_down', name: 'Courier partner failing (P2)', severity: 'P2', team: 'Digital Ops',
    // RECLASSIFIED 2026-08-11 (was 'mixed'): courier_worst_fail_rate reads the same cancelled/
    // refused/returned/RTO state lists as delivery_fail_rate, just per-vendor — every counted state
    // is a well-formed outcome the courier REPORTED (it answered), so this is business per the
    // errclass principle, even when the operational cause sits with the partner. A partner going
    // silent (the truly technical failure mode) never shows up here — it shows as callbacks/dispatch
    // never arriving, which delivery_stuck / courier_backlog_* (class 'technical') already catch.
    alert_class: 'business',
    metric_key: 'courier_worst_fail_rate', operator: 'gte', threshold: 0.40, window_hours: 24, min_sample: 20,
    description: 'At least one courier is failing/returning ≥40% of shipments (with a meaningful sample) — a single-partner outage the blended delivery rate would hide.',
    runbook: '1) Troubleshoot → Delivery: sort by vendor to see which courier is breaching (SMSA/OTO/Barq/iMile/STCC/etc.). 2) One courier → contact that partner and check their status callbacks/webhook. 3) If it is the default courier, consider rerouting new shipments. 4) Engage the logistics owner.' },
  { key: 'conversion_drop', name: 'Onboarding conversion drop (P2)', severity: 'P2', team: 'Sales Ops',
    alert_class: 'business',  // funnel/business outcome, not an API failure
    metric_key: 'onboarding_conversion', operator: 'lte', threshold: 0.02, window_hours: 24, min_sample: 50,
    description: 'Completed/created conversion near zero (baseline ~4–5%; low value partly reflects the completed-flag replica lag).',
    runbook: '1) Completed/created conversion near zero. 2) Caveat: partly reflects the completed-flag replica lag — verify against a live source before escalating. 3) If genuinely low, walk the funnel (order → eligibility → payment → activation) for the breaking step and link the matching alert. 4) Sales Ops + Digital Ops jointly.' },
  /* DATA SIM JOURNEY (29 Sep 2026 — TKT-000069 by Sreekanth: the Data SIM journey was on App screens flow but not on the
   * Operational dashboard, because Journey health only shows journeys backed by metrics). Baseline 29 Sep (13 weeks):
   * 540–1,013 orders a week ≈ 80–145 a day, ≈ 20 % activated. */
  { key: 'datasim_volume_drop', name: 'Data SIM orders — volume drop (P3)', severity: 'P3', team: 'mobile-digital-l2',
    alert_class: 'business',
    metric_key: 'datasim_orders', operator: 'lte', threshold: 25, window_hours: 24, min_sample: 0,
    description: 'Fewer than 25 Data SIM orders (a group-11 number chosen at checkout) in 24 h against a baseline of 80–145 a day — the journey went quiet: the Data SIM plans disappeared from the catalog, number selection has no group-11 numbers to offer, or the app build broke the flow. A quiet journey shows up as silence, not as errors.',
    runbook: '1) Mobile › Flow guard › Plan catalog: are the Data SIM / MBB plans still enabled? 2) Check the number pool: Apollo GET /api/apollo/numbers?vanity_id=… for the data group must return numbers. 3) App screens flow › DataSIM: walk the journey on the app once. 4) Mobile digital L2 (TCS) for the catalog / pool; Sales Ops if a plan was retired on purpose (then adjust the threshold).' },
  { key: 'datasim_conversion_drop', name: 'Data SIM conversion drop (P3)', severity: 'P3', team: 'mobile-digital-l2',
    alert_class: 'business',
    metric_key: 'datasim_conversion', operator: 'lte', threshold: 0.04, window_hours: 24, min_sample: 40,
    description: 'Activated / created Data SIM orders of the last 24 h at 4 % or below (baseline ≈ 20 % over a week; orders of the last day have had less time, so the daily figure sits lower — the threshold is set well under it). The orders keep coming but nobody gets to activation: payment, eligibility or the activation step is failing for this journey.',
    runbook: '1) Troubleshoot for the window: payments, eligibility and activation errors of the day — a Data SIM order pays through the same checkout, so a gateway incident shows here too. 2) Customer 360 with two recent Data SIM orders (Flow guard › Findings lists group-11 orders; Journey & Orders): where does the order stop? 3) Compare with the voice onboarding conversion: both down = platform; Data SIM only = the data-SIM branch (plan, number group, has_data_sim). 4) Mobile digital L2 (TCS).' },
  { key: 'datasim_activation_fail', name: 'Data SIM activation failures — BSS (P2)', severity: 'P2', team: 'mobile-digital-l2',
    alert_class: 'technical',
    metric_key: 'datasim_activation_fail_rate', operator: 'gte', threshold: 0.3, window_hours: 3, min_sample: 10,
    description: '30 % or more of the BSS activation calls of data numbers (activation_logs rows whose msisdn starts with 9668 — data SIMs are activated under the data number, never with an order id — Semati excluded) failed in the last 3 hours, on at least 10 calls. Baseline 29 Sep: 175 create-individual-subscriber calls in 7 days, 0 failed. The data-SIM subscriber creation (data number range, data rating profile) is failing while voice activations may still pass — a BSS or provisioning fault specific to the data group.',
    runbook: '1) Troubleshoot › Activation: filter msisdn 9668… in the window, read the dominant status_code / message. 2) Same failure on voice activations? If yes, it is the BSS activation incident (see Activation failure storm); if data numbers only, the data number group or the data plan profile in BSS. 3) Mobile digital L2 (TCS) + BSS L3 (Oracle) with the failing numbers from Affected cases. 4) Hold the Data SIM plans in the catalog only if the failure is confirmed systemic.' },
  { key: 'datasim_semati_deny_spike', name: 'Data SIM Semati refusals spike (P3)', severity: 'P3', team: 'mobile-digital-l2',
    alert_class: 'business',
    metric_key: 'datasim_semati_deny_rate', operator: 'gte', threshold: 0.85, window_hours: 3, min_sample: 20,
    description: 'The regulator refused 85 % or more of the data-number registrations (Semati new-mobile-number on msisdn 9668…) in 3 hours, on at least 20 calls. Baseline 29 Sep: ≈ 60 % refused (726 · 724 · 300 · 812 — the customer already holds the maximum number of lines, id / nationality checks) — a high floor by nature, so only a near-total refusal means something changed: a Semati policy or outage (715 / 5002 are the technical codes, see the Semati rules), or a batch of ineligible customers from one channel.',
    runbook: '1) Troubleshoot › Activation, msisdn 9668…, group by status_code: 726 / 724 / 300 / 812 = refusals (business), 715 / 5002 / 408 = Semati down (technical — the Semati provider rules fire too). 2) One channel or platform behind the spike? (Affected cases: platform column). 3) Refusals are the regulator\'s answer — nothing to fix on our side unless the eligibility pre-check stopped filtering them before payment. 4) Mobile digital L2 (TCS) if the pre-check regressed.' },
  { key: 'offhours_orders', name: 'Off-hours unusual activity (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'business',  // activity anomaly (test/automation/fraud) — not an error class at all
    metric_key: 'offhours_orders', operator: 'gte', threshold: 700, window_hours: 3, min_sample: 0,
    active_from: 1, active_to: 6, description: 'Order attempts during the 01:00–06:00 KSA dead window (test/automation/fraud).',
    runbook: '1) Order attempts in the KSA dead window — usually test/automation, occasionally fraud. 2) Troubleshoot: inspect the sources/IPs and whether the orders complete. 3) A burst from one source → flag for fraud/security review. 4) Benign if it is known automation.' },
  { key: 'dealer_activity_drop', name: 'Dealer commissioning stalled in working hours (P2)', severity: 'P2', team: 'Sales Ops',
    alert_class: 'technical',  // channel-silence watchdog — a feed/platform outage is the actionable cause (demand drop is the caveat)
    metric_key: 'dealer_activity', operator: 'lte', threshold: 2, window_hours: 6, min_sample: 1,
    active_from: 9, active_to: 22, description: 'Dealer (DMS) completed-order volume collapsed during dealer hours (data-dependent — dealer feed may be absent in the replica).',
    runbook: '1) Dealer (DMS) completed-order volume collapsed in dealer hours. 2) First check data: the dealer feed may be absent/lagged in the replica (known caveat) — confirm against a live source. 3) If real, contact dealer-channel ops. 4) Do not page if it is a known feed gap.' },

  // ---------- P3 : watch ----------
  { key: 'abandoned_orders', name: 'Abandoned onboarding surge (P3)', severity: 'P3', team: 'Sales Ops',
    alert_class: 'business',  // abandonment = customer outcome; the platform answered every step it was asked
    metric_key: 'onboarding_abandoned', operator: 'gte', threshold: 15000, window_hours: 24, min_sample: 0,
    description: 'Abandoned (never completed/activated) onboarding surging past the ~9.5k daily baseline.',
    runbook: '1) Abandoned onboarding surging past baseline. 2) Troubleshoot: check where users drop (eligibility / payment). 3) If one step failure rate rose, that is the cause — link to the matching alert. 4) Watch-level; act if a specific step is breaking.' },
  { key: 'volume_drop', name: 'Payment volume drop (P3)', severity: 'P3', team: 'Digital Ops',
    alert_class: 'technical',  // payment-silence watchdog — checkout going quiet in business hours points at the platform first
    metric_key: 'payment_volume', operator: 'lte', threshold: 0.55, window_hours: 3, min_sample: 0,
    active_from: 9, active_to: 22, description: 'Successful payment volume unusually low during business hours.',
    runbook: '1) Successful payment volume unusually low in business hours. 2) Cross-check the payment failure rate and order volume — fewer attempts, or more failures? 3) If failures are normal but volume is down, it is demand/upstream traffic, not a payment fault. 4) Watch-level.' },

  // ---------- Digital-API traffic (Monitoring page · grafana.transaction_logs, MySQL) ----------
  // Live-anchored source (see apiTraffic.js): the metrics return NO rows until API_TRAFFIC_URL is
  // set, so these rules sit silently on "no data in window" — never a false page on a cold config.
  // api_latency_p95 is THRESHOLD-NORMALISED: value = p95 / effective threshold (global ms or the
  // per-API override from console_settings 'api_latency_thresholds', editable on the Monitoring
  // page). The rule therefore stays a plain ratio 'gte 1' / 'gte 2' — 100% = exactly at its own
  // threshold — and per-API overrides flow into firing without touching the rule.
  { key: 'api_latency_breach', name: 'Digital-API p95 latency over threshold (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'technical',  // latency is a platform-response property — the API is failing to answer in time
    metric_key: 'api_latency_p95', operator: 'gte', threshold: 1, window_hours: 1, min_sample: 30,
    description: 'Global p95 latency of the Digital-API layer is at/over the configured threshold (Monitoring → Latency alerting; value is p95 ÷ threshold, so 100% = at threshold). Threshold PROVISIONAL — calibrate the ms value against the live Grafana duration trend.',
    runbook: '1) Open Monitoring → API health: read the avg/max duration trend and the top-20 slow calls — one API dominating means a slow dependency, broad slowness means platform/DB/GW. 2) Cross-check the APIGW node strip and the BSS alerts (a dying gateway node or BSS read-path 1500s often shows up as latency first). 3) Tune the ms threshold in Monitoring → Latency alerting if this is the new normal (audited). 4) Escalates to the ×2 P1 twin if it keeps climbing — page Digital Ops L2 then.' },
  { key: 'api_latency_storm', name: 'Digital-API p95 latency ≥2× threshold (P1)', severity: 'P1', team: 'Digital Ops',
    alert_class: 'technical',  // same latency signal, hard-degradation tier
    metric_key: 'api_latency_p95', operator: 'gte', threshold: 2, window_hours: 1, min_sample: 30,
    description: 'Global p95 latency is at DOUBLE the configured threshold — customers are timing out, not just waiting. Threshold PROVISIONAL — calibrate against live.',
    runbook: '1) Treat as a platform incident: Monitoring → API health for the slow-call table and which APIs dominate. 2) Check the connectivity strip (replica, OSB, APIGW nodes) — shared infra degradation is the usual cause. 3) Correlate with bss_degraded / apigw_node_down; if either is open it is one incident. 4) Page Digital Ops L2.' },
  { key: 'api_latency_per_api', name: 'Digital-API per-API latency override breached (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'technical',  // per-API p95 vs its own override — same platform-latency signal
    metric_key: 'api_latency_p95', operator: 'gte', threshold: 1, window_hours: 1, min_sample: 40,
    dim: { api: '(worst)' },
    description: 'The worst single API\'s p95 latency is over ITS OWN threshold (per-API override, or the global default when none is set). The metric\'s (worst) row carries the max per-API ratio, so this one rule covers every override. Open Monitoring → API health to see WHICH API is breaching (sorted per-API table + p95 column).',
    runbook: '1) Monitoring → API health: sort the per-API table by p95 to name the breaching API. 2) A single slow API with normal siblings = its downstream dependency (BSS read, provider, DB hot spot) — check the matching Troubleshoot category. 3) If the override is simply too tight for that API\'s normal profile, raise it in Monitoring → Latency alerting (audited). 4) Escalate to Digital Ops L2 if the technical-failure rate on the same API is also rising.' },
  { key: 'api_technical_fail_spike', name: 'Digital-API technical failures rising (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'technical',  // errclass technical signatures (1500/5xx/timeouts/SOAP/transport) on the API layer
    metric_key: 'api_technical_fail_rate', operator: 'gte', threshold: 0.10, window_hours: 1, min_sample: 30,
    description: 'Over 10% of Digital-API calls in the last hour failed with TECHNICAL signatures (1500 / 5xx / 408 / timeouts / SOAP-OSB faults / transport — errclass mirror on response code + message). Business "no"s are excluded, so this is platform faulting, not customer refusals. Threshold PROVISIONAL — calibrate against live.',
    runbook: '1) Monitoring → API health: read the response-code distribution and the error-message list — one code dominating names the upstream (1500 = BSS/OSB SOAP path, 715/5002 = Semati, 5xx = app layer). 2) Cross-check the matching provider alert family before treating it as an API-layer fault. 3) Watch the trend toward the 25% storm threshold. 4) Pre-warn Digital Ops L2 if climbing.' },
  { key: 'api_technical_fail_storm', name: 'Digital-API technical-failure storm (P1)', severity: 'P1', team: 'Digital Ops',
    alert_class: 'technical',  // same signal, storm tier
    metric_key: 'api_technical_fail_rate', operator: 'gte', threshold: 0.25, window_hours: 1, min_sample: 30,
    description: 'Over a quarter of Digital-API calls are failing with technical signatures — a platform-wide fault (BSS/OSB/gateway/app). Threshold PROVISIONAL — calibrate against live.',
    runbook: '1) Monitoring → API health: dominant code + error messages name the layer. 2) Check the connectivity strip and the open P1s (bss_soap_fault_1500, semati_provider_down, apigw_node_down) — this rule usually confirms one of them at the API surface. 3) Open/join the incident with the blast radius (every journey rides these APIs). 4) Page Digital Ops L2.' },

  // ---------- App error-log family (api_error_events ← api_error_logger on 17/18) ----------
  // All thresholds PROVISIONAL — set from Aug-2026 baselines (blocks ~80/h avg · -501 ~110/h ·
  // auth ~600/h); calibrate after a week of live data, same as the latency family.
  { key: 'app_ip_block_surge', name: 'IP rate-limit blocks surging (P3)', severity: 'P3', team: 'Digital Ops',
    alert_class: 'business',  // the limiter answered "no" — but the gap-block flaw makes surges customer-impacting
    metric_key: 'app_ip_block_count', operator: 'gte', threshold: 400, window_hours: 1, min_sample: 0,
    description: 'IpRetrial -704 blocks well above the ~80/h baseline — either real abuse or the gap-block flaw biting legit customers (98% of blocks are ≤3-attempt victims on shared CGNAT IPs). PROVISIONAL.',
    runbook: '1) Monitoring → ③ App errors → IP rate-limiting: hourly chart + top blocked IPs (retry range 1–1 = innocent victims, high = real abuser). 2) Legit-victim pattern → check ip_session_time/ip_elapse_time settings (the gap-block combo). 3) Single abusive IP → keep blocked, consider upstream block. 4) Push the ip_retrial.rb gap-logic fix with the app team.' },
  { key: 'app_ip_block_storm', name: 'IP rate-limit block storm (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'business',
    metric_key: 'app_ip_block_count', operator: 'gte', threshold: 1000, window_hours: 1, min_sample: 0,
    description: 'Rate-limiter blocking at storm level — recharge/voucher journeys effectively degraded for many customers. PROVISIONAL.',
    runbook: 'Same drill as the surge rule; at this level treat as a customer-impacting incident: verify settings immediately and inform the app team; consider a temporary ip_session_time raise to neutralise the gap-block while investigating.' },
  /* RECHARGE / BILL-PAY LOOKUP (27 Sep 2026): the CIO typed his number on my.salammobile.sa › Recharge number and got
   * "We detected an error! Make sure the information used is accurate." — validate_details had failed before any payment
   * existed, invisible to recharge_fail_spike. The web page shows that one popup for every code. */
  { key: 'recharge_lookup_fail_spike', name: 'Recharge / bill-pay lookup failing on the web and app (P3)', severity: 'P3', team: 'Digital Ops',
    alert_class: 'business',
    metric_key: 'recharge_lookup_failures', operator: 'gte', threshold: 12, window_hours: 1, min_sample: 0,
    description: 'validate_details on the Recharge / pay-the-bill page answering an error — -112 unknown number · -512 "account suspended" = any gateway/BSS failure on the profile read (the controller hides the cause) · -513 line still pending · -501 backend error on the postpaid due-amount path (UIL /bss/account/*). Customers see "We detected an error!" before any payment row exists, so recharge_fail_rate never counts them. IP-limiter blocks (-704) are excluded — app_ip_block_surge / _storm own them. PROVISIONAL threshold — calibrate after a week of live data.',
    runbook: '1) Monitoring → ③ App errors → drill the code of the hour. -501 with "Error 502" or -512 on healthy lines = the UIL account family (/bss/account/get-account-profile/v2, execute-account-blnc-query) or the profile read failing — check Monitoring → UIL / Digital-API health for the same minutes and open (or join) the gateway/BSS incident; -513 = lines still PENDING (just activated: the app caches the profile 10 min); -112 = typos, no action. 2) For a named customer: Customer 360 → Logs & Diagnostics → "Recharge / bill-pay attempts" (codes, IPs, limiter verdict, the due-amount panel history). 3) Recurring -512 / -501 while the gateway is healthy → ticket to the app team (TCS) with request_id / trace_id from the drill: recharge_controller.rb#find_account_manager maps every exception to -512 and drops the message; total_bill_manager.rb has no fallback when the account balance query fails.' },
  /* REFUND EXPOSURE (25 Sep 2026) — the mail review of 2,338 refund threads: every approved refund was a platform event
   * we could have seen first. Both rules are business-class: the customer paid, the platform did not deliver. */
  { key: 'refund_exposure_surge', name: 'Refund exposure rising — customers paid, service not delivered (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'business',
    metric_key: 'refund_exposure_new', operator: 'gte', threshold: 8, window_hours: 24, min_sample: 0,
    description: 'refundRadar detected 8+ new refund candidates in 24 h (paid-not-activated, port-in twice, change plan charged then failed, SIM replacement paid, delivery failed on a paid order, charged twice). Baseline from the mail review: ~2/day in Aug, ~4/day in Sep 2026. A surge = one flow broke after a release or a partner (Semati, Tap/UPG, courier) degraded — money already owed.',
    runbook: '1) Mobile → Refund exposure: the kind with the surge names the flow. 2) Open 2–3 cases → Customer 360 trace: same error (Semati 727/738, IAM token, courier state)? 3) Fix the flow / raise with the partner; the cases stay listed until refunded. 4) Send the batch to L2 for refund with the INC numbers — no more waiting for the complaint.' },
  { key: 'refund_exposure_backlog', name: 'Refund backlog — open candidates above 3,000 SAR (P3)', severity: 'P3', team: 'Digital Ops',
    alert_class: 'business',
    metric_key: 'refund_exposure_open_sar', operator: 'gte', threshold: 3000, window_hours: 24, min_sample: 0,
    description: 'Sum of OPEN refund candidates (not yet approved / refunded / dismissed) above 3,000 SAR — customers waiting for money the platform already knows it owes. Stays raised until the backlog is worked.',
    runbook: '1) Mobile → Refund exposure → filter Open, oldest first. 2) Approve / refund with the INC number, or dismiss with a note (false positive). 3) Recurring kinds → product defect ticket (port-in twice, change-plan IAM token, eSIM replacement).' },
  /* REFUND DESK SLAs (26 Sep 2026 — Teams management › Refund desks). The desk has two clocks; both rules are P4 = INTERNAL
   * tickets: the owning team is chased by the P4 ack ladder, nobody is paged, management is not informed. Approval waits on
   * the Salam side (the approvers named on the desk), execution on the L2 team that posts the refund in proxycms. The hours
   * come from the desk (default 24 h to decide, 48 h to post); the rule only says "one or more overdue". */
  { key: 'refund_approval_overdue', name: 'Refund approval overdue — request sent, no decision within the desk SLA (P4)', severity: 'P4', team: 'digital-l1',
    alert_class: 'business',
    metric_key: 'refund_sla_approval_overdue', operator: 'gte', threshold: 1, window_hours: 24, min_sample: 0,
    description: 'At least one case of a sent approval request (the refund desk batch) has no decision — approve / refunded / dismiss on the page — after the desk\'s approval SLA (Teams management › Refund desks, default 24 h). The customer is still waiting for money the console already knows it owes; the L2 team cannot post the refund before the approval. Internal P4: the approvers are named on the ticket and on the desk.',
    runbook: '1) Mobile › Refund exposure → Refund desk tab: the "approval overdue" tile lists the batch and the cases. 2) The approvers of the desk decide on the page (Approve — one click, recorded by name — or Dismiss with a note). 3) If the approver is away, a super admin adds a second approver on the desk (Teams management › Refund desks). 4) The rule clears itself when no case is beyond the SLA.' },
  { key: 'refund_execution_overdue', name: 'Refund execution overdue — approved, not posted in proxycms within the desk SLA (P4)', severity: 'P4', team: 'mobile-digital-l2',
    alert_class: 'business',
    metric_key: 'refund_sla_execution_overdue', operator: 'gte', threshold: 1, window_hours: 24, min_sample: 0,
    description: 'At least one APPROVED case is not yet shown as refunded by the proxycms register after the desk\'s execution SLA (default 48 h from the approval). The approval was given; the refund has not been posted (or it failed at the gateway — see refund_gateway_failed). Internal P4 for the executing L2 team.',
    runbook: '1) Mobile › Refund exposure → filter Approved, oldest first: each row carries the payment id and the proposed proxycms reason. 2) proxycms › Refunds › post the refund with the INC; the console closes the case from the register on the next tick (≤ 15 min). 3) A refund that came back "fail" from the gateway → Re-Request / Rsync, or Finance with the INC. 4) The rule clears itself when no approved case is beyond the SLA.' },
  { key: 'refund_gateway_failed', name: 'Refund failed at the payment gateway — customer still unpaid (P3)', severity: 'P3', team: 'Digital Ops',
    alert_class: 'business',
    metric_key: 'refund_gateway_failed', operator: 'gte', threshold: 1, window_hours: 24, min_sample: 0,
    description: 'A refund posted in proxycms came back FAILED from the gateway (refunds.status = fail — Tap / HyperPay / Salam Pay rejected the reversal, the app put the payment back to success). The customer was told the money is coming and it is not. Zero is the normal value.',
    runbook: '1) Mobile → Refund exposure → proxycms register → filter status = failed: the fail_reason column is the gateway answer. 2) proxycms › Refunds › the row › Re-Request (or Rsync Refund when pending). 3) If the gateway keeps rejecting (settled > 6 months, card closed) → manual refund through Finance with the INC.' },
  /* ONBOARDING FLOW GUARD (29 Sep 2026 — TKT-000068 by Sreekanth, "an alert for onboardings placed with a non-business-approved
   * flow"). Detected by flowGuard.js on the replica every 15 min (numbers × onboarding_orders × plans), kept in flow_findings,
   * shown on Mobile › Flow guard. Owner: the Mobile digital L2 team (TCS) — the web checkout is theirs. Agent 2 writes a
   * deterministic triage note (the finding IS the cause) and the incident opens on that team; Agent 1 reports the 24 h picture.
   * Measured 29 Sep (180 d): vanity-on-prepaid 5 attempts, 0 activated; class mismatch 0; disabled-at-order-time needs the plan
   * timeline that starts with the first tick (older orders are judged against plans.updated_at, the evidence says so). */
  { key: 'onboarding_flow_vanity_prepaid', name: 'Vanity number activated on a prepaid plan (P3)', severity: 'P3', team: 'mobile-digital-l2',
    alert_class: 'business',
    metric_key: 'onboarding_flow_vanity_prepaid', operator: 'gte', threshold: 1, window_hours: 24, min_sample: 0,
    description: 'A Silver / Gold / Platinum / Diamond number (numbers.group_id 4–7) was ACTIVATED on a prepaid plan (plans.plan_type = 1) — a flow the business never approved: vanity classes are sold with postpaid plans only (the DMS dealer app enforces it in code; on the web the purchase step refuses it — 5 attempts in 180 days, none went through). One activation is enough: the customer holds a vanity number without the postpaid contract, and the vanity fee (Silver 500 · Gold 2,500 · Platinum 7,000 SAR, Apollo catalog) is the money at stake. Attempts that never activate are on the P4 rule below and on Mobile › Flow guard.',
    runbook: '1) Mobile › Flow guard → Vanity · prepaid → the activated row: checkout code, masked number, class, plan. 2) Customer 360 with the checkout code: confirm the activation and the plan on the line (BSS profile), read the platform / app version on the order. 3) Mobile digital L2 (TCS): why did the purchase step accept it — release regression, deep link, cached catalog? Ask for the fix and the regression test. 4) Business (Sales Ops) decides: keep the number and convert to postpaid, or charge the vanity fee. 5) Close the finding with the INC on the page; the incident closes when the rule stops firing.' },
  { key: 'onboarding_flow_vanity_prepaid_attempts', name: 'Vanity number chosen with a prepaid plan — attempts (P4)', severity: 'P4', team: 'mobile-digital-l2',
    alert_class: 'business',
    metric_key: 'onboarding_flow_vanity_prepaid_attempts', operator: 'gte', threshold: 3, window_hours: 24, min_sample: 0,
    description: 'Three or more orders in 24 h chose a vanity number together with a prepaid plan, activated or not — the front-end let the customer pair them and the purchase step had to refuse. Baseline (180 d): 5 attempts in total, so 3 in a day means number selection changed or a campaign is steering customers into a pairing the checkout will reject. Informational: nothing activated (that is the P3 rule).',
    runbook: '1) Mobile › Flow guard → Vanity · prepaid → the attempts of the day (status open / expired). 2) Same platform / app version? Same plan? — one release or one campaign. 3) Mobile digital L2 (TCS): number selection should not offer vanity classes with a prepaid plan (or should say why at selection time). 4) No customer action — the reservations lapse on their own (the guard marks them expired).' },
  { key: 'onboarding_flow_plan_disabled', name: 'Order activated on a plan that was already disabled (P3)', severity: 'P3', team: 'mobile-digital-l2',
    alert_class: 'business',
    metric_key: 'onboarding_flow_plan_disabled', operator: 'gte', threshold: 1, window_hours: 24, min_sample: 0,
    description: 'An order was ACTIVATED on a plan whose plans.enabled was already false WHEN THE ORDER WAS PLACED (the console\'s plan timeline decides; before the first snapshot the plan\'s updated_at is used and the evidence says so). A plan switched off after the order is never counted, and the plans sold through their own flow while hidden from the public catalog — Tamkeen, Freelancer, Visitor, Martyr, FnF, Tygo, Hajj, SIMPAL … — are allow-listed in Console Settings › Flow guard. What remains is a catalog the app should no longer serve: a stale app build, a deep link, a cached plan list.',
    runbook: '1) Mobile › Flow guard → Disabled plan: the plan, when it was disabled, how many hours after that the order came, the platform / app version. 2) If the plan is legitimately sold through a dedicated flow, add it to the allow-list (Settings on the page) — the finding closes and never returns. 3) Otherwise Mobile digital L2 (TCS): which catalog served it (Magento plan list, app cache, deep link) and the fix. 4) Business decides for the customer: honour the order or migrate to the live equivalent (change plan). 5) Close with the INC.' },
  { key: 'onboarding_flow_plan_disabled_attempts', name: 'Orders placed on a disabled plan — attempts (P4)', severity: 'P4', team: 'mobile-digital-l2',
    alert_class: 'business',
    metric_key: 'onboarding_flow_plan_disabled_attempts', operator: 'gte', threshold: 5, window_hours: 24, min_sample: 0,
    description: 'Five or more orders in 24 h were placed on plans disabled at order time (activated or not, allow-listed plans excluded). Signals a catalog still selling a retired plan at scale — usually right after a plan is switched off while apps keep the old list. Informational until one activates (P3 rule).',
    runbook: '1) Mobile › Flow guard → Disabled plan → group by plan: one plan = a retirement the apps have not picked up; many plans = the catalog refresh itself. 2) Mobile digital L2 (TCS): force the plan-list refresh / invalidate the cache; confirm the web and the app builds. 3) Allow-list any plan that is sold through its own flow.' },
  { key: 'onboarding_flow_class_mismatch', name: 'Number class does not match the plan — data SIM ↔ voice (P3)', severity: 'P3', team: 'mobile-digital-l2',
    alert_class: 'business',
    metric_key: 'onboarding_flow_class_mismatch', operator: 'gte', threshold: 1, window_hours: 24, min_sample: 0,
    description: 'An activated order pairs a Data SIM number (numbers.group_id 11) with a voice plan, or a voice number with a Data SIM / MBB plan (plans.has_data_sim or the plan name). The number group and the plan family come from two different checkout steps; when they disagree, BSS holds a subscriber whose number range and rating profile do not belong together. Baseline (180 d): 0.',
    runbook: '1) Mobile › Flow guard → Class ↔ plan: the order, the number class and the plan. 2) Customer 360 → live BSS profile: subscriber type vs number range. 3) Mobile digital L2 (TCS) + BSS: correct the subscription before the customer finds a service the plan does not cover. 4) Fix the checkout step that let the pairing through.' },
  { key: 'app_crash_surge', name: 'App crashes rising (unhandled exceptions, P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'technical',  // nil-errors etc. — the platform failed, customer got a meaningless -501
    metric_key: 'app_crash_count', operator: 'gte', threshold: 400, window_hours: 1, min_sample: 0,
    description: 'Unhandled Ruby exceptions (-501 with exception_class) above ~4× the baseline — usually one broken code path after a release. PROVISIONAL.',
    runbook: '1) Monitoring → ③ App errors → category "App crashes": the dominant message/frame names the bug (e.g. undefined method for nil). 2) Check app_version concentration — a new release spike means rollback/hotfix. 3) Ticket the app team with the frame + request_id samples (Case analyzer gives them per trace).' },
  { key: 'app_auth_fail_surge', name: 'Auth/session failures surging (P3)', severity: 'P3', team: 'Digital Ops',
    alert_class: 'business',  // tokens expiring/invalid = expected traffic; a surge can be an attack or an auth outage
    metric_key: 'app_auth_fail_count', operator: 'gte', threshold: 2500, window_hours: 1, min_sample: 0,
    description: 'Token/login failures (~600/h baseline) surging ≥4× — either an auth/IAM problem (everyone logged out) or credential-stuffing. PROVISIONAL.',
    runbook: '1) Monitoring → ③ App errors → category "Auth & session": codes -205/-203 dominating = token/session backend issue; -300 dominating = login attempts (possible attack — check top IPs). 2) Auth outage → check Redis/IAM health with the app team. 3) Attack pattern → SOC.' },
  { key: 'app_backend_err_surge', name: 'App backend/provider errors rising (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'technical',
    metric_key: 'app_backend_err_count', operator: 'gte', threshold: 500, window_hours: 1, min_sample: 0,
    description: 'Backend-family errors (-500 unreachable, plain -501, TCC -702, Optiva -20003) surging — the app cannot reach or use its upstreams. PROVISIONAL.',
    runbook: '1) Monitoring → ③ App errors → category "Backend / providers": the dominant code names the upstream. 2) Cross-check API-health technical rate + BSS/Semati alert families. 3) Escalate to the owning provider team.' },
  { key: 'otp_verify_drop', name: 'OTP verify-rate dropping — SMS delivery degraded (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'technical',  // customers not RECEIVING the SMS = delivery chain fault (Unifonic/interconnect)
    metric_key: 'otp_verify_rate', operator: 'lte', threshold: 0.45, window_hours: 1, min_sample: 50,
    description: 'OTP sent→verified rate under 45% (baseline typically well above) — customers are not receiving SMS. This is the signature of the 13-Aug Unifonic incident (ticket #583686). PROVISIONAL — calibrate against the live baseline.',
    runbook: '1) Monitoring → ④ SMS: verify-rate trend + retry storms + gateway probe. 2) Ask Yusr "is there an OTP delivery issue?" for the degradation window. 3) Per-operator split (prefix breakdown) — Salam-only OK vs others failing = Unifonic interconnect issue → raise/refresh the Unifonic ticket with the evidence table. 4) Check sms_vendors — consider failover to the standby vendor.' },
  { key: 'otp_verify_collapse', name: 'OTP delivery collapse (P1)', severity: 'P1', team: 'Digital Ops',
    alert_class: 'technical',
    metric_key: 'otp_verify_rate', operator: 'lte', threshold: 0.25, window_hours: 1, min_sample: 50,
    description: 'OTP verification collapsed — logins/onboarding effectively blocked for most customers. PROVISIONAL.',
    runbook: 'Treat as a sales-blocking incident: same drill as otp_verify_drop but page immediately, engage Unifonic on the emergency line and evaluate vendor failover (sms_vendors.enable! on the standby).' },
  { key: 'sms_gateway_unreachable', name: 'SMS gateway unreachable from API hosts (P1)', severity: 'P1', team: 'Digital Ops',
    alert_class: 'technical',
    metric_key: 'sms_probe_fail_count', operator: 'gte', threshold: 3, window_hours: 1, min_sample: 0,
    description: 'The Unifonic reachability probe (curl FROM the API hosts) failed ≥3 times in the last hour — DNS/route/TLS to the SMS gateway is broken from the app\'s own vantage point.',
    runbook: '1) Monitoring → ④ SMS → Gateway reachability: which host(s), what error (timeout vs DNS vs refused). 2) Both hosts failing → Unifonic-side or network egress — engage Unifonic + network team. 3) One host → that host\'s egress/DNS. 4) Expect otp_verify_drop to follow within minutes if real.' }
];

/* ================= FIXED / SALAM HOME (unified console) =================
 * The 15 built-ins of the prod Operations Console (salam-dealer-ops alert-engine.ts BUILTIN_RULES),
 * ported 1:1: same names as /operations-console, same severity / operator / threshold / window /
 * min-sample / KSA active hours. Keys and metric keys are `fixed_`-prefixed (plan §2.1), rows carry
 * segment='fixed'. Donor severity 1→P1, 2→P2, 3→P3; donor teams SALES_OPS→'Sales Ops',
 * DIGITAL_OPS→'Digital Ops', OSS_OPS→'OSS Ops', BSS_OPS→'BSS Ops'. Donor `scope` (ticket theme
 * keyword) becomes dim {scope} — fixedMetrics emits one snapshot row per scope. Donor `params` are
 * echoed for documentation; the values actually used are FIXED_PARAMS in fixedMetrics.js.
 * `enabled:false` = seeded OFF (donor ships it on; per-dealer stagnation is noisy — opt in from the UI).
 * The upsert in init.js never touches `enabled`, so operator toggles survive a re-seed. */
const FIXED_RULES = [
  { key: 'fixed_error_spike', name: 'Error spike (P0/P1)', severity: 'P1', team: 'Digital Ops', segment: 'fixed', alert_class: 'technical',
    metric_key: 'fixed_error_p0p1_categories', operator: 'gte', threshold: 1, window_hours: 3, min_sample: 0, params: { spike: 15, windowMin: 60 },
    description: 'Open errors reaching effective priority P0/P1 (money-at-risk categories escalate).',
    runbook: '1) Fixed → Errors: which category is at P0/P1 and its count in the last 60 min. 2) PAYMENT_NOT_NOTIFIED / PROVISION_NO_ORDER = money at risk — page BSS/OSS on-call. 3) Check the order trace for the failing step and API. 4) Resolve the category once the root cause is fixed so the metric clears.' },
  { key: 'fixed_nafath_fail_spike', name: 'Nafath failure spike', severity: 'P2', team: 'Digital Ops', segment: 'fixed', alert_class: 'business',
    metric_key: 'fixed_nafath_fail_rate', operator: 'gte', threshold: 0.30, window_hours: 24, min_sample: 20,
    description: '5G (HomeFI/FWA) identity verification failing above threshold.',
    runbook: '1) Fixed → Overview → Nafath outcomes: TIMEOUT vs REJECTED split. 2) TIMEOUT-dominated = Nafath/Absher side or callback path — check with the platform team. 3) REJECTED = customers declining in the Nafath app (expected share ~10–20%).' },
  { key: 'fixed_semati_fail_spike', name: 'Semati provisioning failure spike', severity: 'P2', team: 'Digital Ops', segment: 'fixed', alert_class: 'technical',
    metric_key: 'fixed_semati_fail_rate', operator: 'gte', threshold: 0.30, window_hours: 24, min_sample: 20,
    description: '5G MSISDN provisioning (Semati SIM lock, after Nafath) failing above threshold — SEMATI_FAILED / MOBILE_EXISTS.',
    runbook: '1) Fixed → Errors: SEMATI_FAILED vs MOBILE_EXISTS. 2) MOBILE_EXISTS = dealer re-using an MSISDN — coach the dealer. 3) SEMATI_FAILED rising across dealers = Semati (TCC) provider issue — engage the Semati owner, cross-check the MVNO Semati alerts.' },
  { key: 'fixed_conversion_drop', name: 'Conversion drop (SDA / dealer)', severity: 'P2', team: 'Sales Ops', segment: 'fixed', alert_class: 'business', channel: 'sda',
    metric_key: 'fixed_conversion_drop_pp', operator: 'gte', threshold: 0.15, window_hours: 24, min_sample: 30,
    description: 'Dealer conversion fell vs the prior 7-day baseline.',
    runbook: '1) Fixed → Overview: outcome mix and by-journey conversion for the window vs last week. 2) One journey collapsing = integration issue (see Nafath / Semati / error rules). 3) All journeys down = platform or a sales-side cause (campaign end, holiday).' },
  { key: 'fixed_manafith_denials', name: 'Manafith denials', severity: 'P2', team: 'Sales Ops', segment: 'fixed', alert_class: 'business',
    metric_key: 'fixed_manafith_deny_rate', operator: 'gte', threshold: 0.20, window_hours: 24, min_sample: 10,
    description: 'Government dealer-validation (Manafith) DENIED above the normal rate.',
    runbook: '1) Fixed → Overview → Manafith denied by region / dealer. 2) Concentrated on a few dealers = licence/registration lapsed — Sales Ops to follow up. 3) Broad = Manafith service change — engage the integration owner.' },
  { key: 'fixed_workhours_drop', name: 'Working-hours activity drop (SDA)', severity: 'P2', team: 'Sales Ops', segment: 'fixed', alert_class: 'business', channel: 'sda',
    metric_key: 'fixed_workhours_activity_ratio', operator: 'lte', threshold: 0.35, window_hours: 3, min_sample: 10, active_from: 15, active_to: 22, params: { baselineDays: 7 },
    description: 'Hourly SDA volume collapsed vs the same-hour baseline during dealer hours.',
    runbook: '1) Confirm the ingest is fresh (Fixed → Overview freshness strip) — a stalled watcher looks like a volume drop. 2) If data is fresh, check the SDA app / login path with a dealer. 3) Inform Sales Ops if it is a field-side cause (holiday, event).' },
  { key: 'fixed_offhours_activity', name: 'Off-hours unusual activity (SDA)', severity: 'P2', team: 'Digital Ops', segment: 'fixed', alert_class: 'business', channel: 'sda',
    metric_key: 'fixed_offhours_sda_attempts', operator: 'gte', threshold: 30, window_hours: 3, min_sample: 0, params: { offStart: 1, offEnd: 6 },
    description: 'SDA attempts during the 01:00–06:00 KSA dead window (test/automation/fraud).',
    runbook: '1) Fixed → SDA map / recent attempts filtered to the night window: which dealers and from where. 2) One dealer = test or automation — contact the dealer. 3) Many dealers / same device = suspected credential sharing or fraud — escalate to Fraud & Security.' },
  { key: 'fixed_dealer_stagnation', name: 'Per-dealer stagnation (SDA)', severity: 'P3', team: 'Sales Ops', segment: 'fixed', alert_class: 'business', channel: 'sda', enabled: false,
    metric_key: 'fixed_dealer_stagnation_count', operator: 'gte', threshold: 1, window_hours: 3, min_sample: 0, active_from: 15, active_to: 22, params: { minDays: 3, minBaseline: 5, minWindowAttempts: 3 },
    description: 'A warm dealer with attempts this window but zero completions. Seeded OFF (noisy) — enable from the Rules tab.',
    runbook: '1) Fixed → Overview → Top dealers: the stagnating dealer\'s attempts and last error. 2) Same error every attempt = coaching / data issue (ODB, ID). 3) Different errors = platform — check the Fixed error board.' },
  { key: 'fixed_dealer_timeout_wave', name: 'Dealer timeout wave (P2)', severity: 'P2', team: 'Digital Ops', segment: 'fixed', alert_class: 'technical',
    metric_key: 'fixed_timeout_dealers', operator: 'gt', threshold: 5, window_hours: 1, min_sample: 0, params: { windowMin: 30 },
    description: 'More than 5 dealers hit timeout-class errors (Absher verify-code / Nafath / API timeouts) within 30 minutes.',
    runbook: '1) Fixed → Errors: TIMEOUT / NAFATH_TIMEOUT events in the last 30 min — which step (Absher verify, Nafath callback, order API). 2) Same step across dealers = upstream (Absher/Nafath/BSS) slow — engage the provider. 3) Watch for escalation to the P1 storm rule.' },
  { key: 'fixed_dealer_timeout_storm', name: 'Dealer timeout storm (P1)', severity: 'P1', team: 'Digital Ops', segment: 'fixed', alert_class: 'technical',
    metric_key: 'fixed_timeout_dealers', operator: 'gt', threshold: 10, window_hours: 1, min_sample: 0, params: { windowMin: 30 },
    description: 'More than 10 dealers hit timeout-class errors within 30 minutes — treat as a platform-wide incident.',
    runbook: 'Platform-wide: open a P1, page Digital Ops L2 and the owning provider (Absher / Nafath / BSS per the failing step), and inform Sales Ops that dealers will see timeouts until resolved.' },
  { key: 'fixed_sms_balance_low', name: 'SMS balance low (Unifonic)', severity: 'P2', team: 'BSS Ops', segment: 'fixed', alert_class: 'technical',
    metric_key: 'fixed_sms_balance', operator: 'lt', threshold: 500, window_hours: 24, min_sample: 0,
    description: 'Unifonic SMS-gateway balance dropped below the safe buffer — top up before OTP/consent messages stop delivering (at 0 they queue but never arrive). Needs FIXED_SMS_BALANCE_URL; without it the metric has no data and the rule never fires.',
    runbook: '1) Top up the Unifonic account (one consent OTP ≈ 12 units). 2) Until topped up, consent OTPs silently fail — warn Sales Ops. 3) Verify sends resume (balance > 0 on the next send response).' },
  { key: 'fixed_ticket_order_api_error', name: 'New-connection / order API-error spike (tickets)', severity: 'P2', team: 'OSS Ops', segment: 'fixed', alert_class: 'technical',
    metric_key: 'fixed_incident_ticket_count', operator: 'gte', threshold: 5, window_hours: 168, min_sample: 0, dim: { scope: 'API error' },
    description: 'Spike in Fixed \'New Connection API Error\' tickets — the ordering/BSS-OSS integration is failing.',
    runbook: '1) Fixed → Playbook / tickets: the week\'s "API error" tickets and their order numbers. 2) Trace one order end-to-end (Fixed → order trace) to find the failing OSS/BSS call. 3) Engage OSS Ops with the request ids.' },
  { key: 'fixed_ticket_payment_suspend', name: 'Payment / SADAD ticket spike (tickets)', severity: 'P2', team: 'BSS Ops', segment: 'fixed', alert_class: 'business',
    metric_key: 'fixed_incident_ticket_count', operator: 'gte', threshold: 5, window_hours: 168, min_sample: 0, dim: { scope: 'Payment' },
    description: 'Spike in Fixed payment/SADAD tickets (incl. \'paid but suspended\').',
    runbook: '1) List the week\'s Payment/SADAD tickets — paid-but-suspended dominates? 2) Check the SADAD → BSS payment notification path with BSS Ops. 3) Bulk-restore suspended accounts once payments are matched.' },
  { key: 'fixed_ticket_gateway_system', name: 'Gateway / system ticket spike (tickets)', severity: 'P1', team: 'Digital Ops', segment: 'fixed', alert_class: 'technical',
    metric_key: 'fixed_incident_ticket_count', operator: 'gte', threshold: 3, window_hours: 168, min_sample: 0, dim: { scope: 'Gateway' },
    description: 'Spike in Fixed API-gateway / platform tickets (e.g. RUH-GETAPIGWP).',
    runbook: '1) Gateway tickets = the API gateway (RUH-GETAPIGWP) is failing for dealers/customers. 2) Check gateway health and recent deployments with the platform team. 3) Open a P1 if orders are blocked.' },
  { key: 'fixed_incident_sla_breach', name: 'Incident SLA-breach rate (tickets)', severity: 'P3', team: 'Digital Ops', segment: 'fixed', alert_class: 'business', enabled: false,
    metric_key: 'fixed_incident_sla_breach_rate', operator: 'gte', threshold: 0.30, window_hours: 168, min_sample: 5,
    description: 'Share of CTT tickets whose SLA was Missed over the week. Not a prod built-in (the metric exists there without a seeded rule) — seeded OFF for parity; enable when the ticket feed is trusted.',
    runbook: '1) Review the SLA-missed tickets by assigned group. 2) Raise with the owning group lead; adjust OLA if systematic.' },
  /* ---- APP-LOG smart thresholds (15 Sep 2026) — source unified_console.fixed_app_events (combined.log on 146).
   * No static counts: each failing signature is compared to its own 14-day baseline (robust z), a signature never
   * seen before is its own alert, a worker looping on the same failure is its own alert, and Yakeen/ELM has both
   * a passive rate and the synthetic probe. Incident text carries the signature (dim.note). ---- */
  { key: 'fixed_applog_anomaly_technical', name: 'App log · technical failure anomaly', severity: 'P2', team: 'Digital Ops', segment: 'fixed', alert_class: 'technical',
    metric_key: 'fixed_applog_anomaly_technical', operator: 'gte', threshold: 8, window_hours: 1, min_sample: 10,
    description: 'The worst TECHNICAL failing signature (channel · step) in the Fixed app log is ≥ 8 robust z above its own 14-day baseline for this hour of day AND at least 10 JOURNEYS more than usual and twice its usual count (≥ 10 in the hour). Counted per customer journey since alpha.169 — one customer retrying is one journey, and journeys whose order was processed are left out (errors to review). Since 9 Oct 2026 a refused step takes the class of its own error line — before, 82 % of these "technical" failures were refusals and the z sat at 13 on a normal hour (stopgap 150). The excess guard keeps a quiet signature going from 0 to 12 from reading as an anomaly; the max over ~40 signatures is why the bar is 8, not 3.5.',
    runbook: '1) Fixed → Troubleshoot → From the app log: the signature is in the incident text; open the channel card for the step and reason. 2) Impact check with the reason text: ongoing / recovering, since when, how many customers. 3) Provider named (Yakeen, Absher, Nafath, Semati)? Run the probe / check with the provider. 4) 5xx or timeout on an app step → platform team with the request ids from the lane.' },
  { key: 'fixed_applog_anomaly_business', name: 'App log · business refusal anomaly', severity: 'P3', team: 'Digital Ops', segment: 'fixed', alert_class: 'business',
    metric_key: 'fixed_applog_anomaly_business', operator: 'gte', threshold: 10, window_hours: 1, min_sample: 25,
    description: 'The worst BUSINESS refusal signature (no coverage, NIC mismatch, blacklist, wrong OTP…) is ≥ 10 robust z above its own baseline AND at least 25 journeys more than usual and twice its usual count (per journey, orders processed apart — alpha.169) — a refusal that suddenly multiplies is usually a data, plan or provider-rule change, not customers.',
    runbook: '1) Troubleshoot → From the app log: which step and reason. 2) A refusal spike on one step = check what changed (plan, ODB data, provider rules) with Sales Ops / OSS. 3) If it is one dealer or one region, it is behaviour, not a fault.' },
  { key: 'fixed_applog_new_signature', name: 'App log · new error never seen before', severity: 'P3', team: 'Digital Ops', segment: 'fixed', alert_class: 'technical',
    metric_key: 'fixed_applog_new_signature', operator: 'gte', threshold: 3, window_hours: 1, min_sample: 0,
    description: 'THREE OR MORE failing signatures (channel · step) that never appeared in the last 14 days, each on ≥ 3 customer journeys whose order was not processed, in the same hour — a release, a config change or a new provider behaviour. One new signature an hour is normal here (measured p90 = 1 over 14 days), so a single one is logged, not paged.',
    runbook: '1) The incident text names the signature(s). 2) Troubleshoot → From the app log → channel card → reason text. 3) Was there a deploy? Ask the app team; the Log Intelligence agent has a first triage for the new signature.' },
  { key: 'fixed_applog_retry_loop', name: 'App log · retry loop (worker failing on a schedule)', severity: 'P3', team: 'Digital Ops', segment: 'fixed', alert_class: 'technical',
    metric_key: 'fixed_applog_retry_loop', operator: 'gte', threshold: 2, window_hours: 3, min_sample: 0,
    description: 'TWO OR MORE workers each failing the same way ≥ 30 times over ≥ 20 min on a flat cadence with no customer request behind them. One such loop is permanently running (invoices.voidInvoice → 500; measured p99 = 1 over 14 days), so the rule fires when a SECOND appears. The standing loop is a platform fix, not an alert.',
    runbook: '1) The incident text names the worker and reason. 2) One ticket to the app / payments team with the ids from the log — do not treat as N customer errors. 3) Resolves itself once the worker stops failing for 20 min.' },
  { key: 'fixed_yakeen_technical_rate', name: 'Yakeen / ELM technical failure rate', severity: 'P2', team: 'Digital Ops', segment: 'fixed', alert_class: 'technical',
    metric_key: 'fixed_yakeen_technical_rate', operator: 'gte', threshold: 0.30, window_hours: 1, min_sample: 5,
    description: 'Yakeen (getYakeenInfo / getYakeenAddress) calls in the app log failing TECHNICALLY (504, timeout, 5xx) ≥ 30 % over the last hour with ≥ 5 calls — ELM unstable, as on 7 Jul and 14 Sep 2026.',
    runbook: '1) Run the Yakeen probe from Troubleshoot (4 ELM calls, billed) to confirm from the console side. 2) Notify ELM / raise with Elm support; update the Operation Center thread. 3) Sales: identity step will fail for everyone — announce, do not let dealers retry in loops. 4) Clears when the rate drops below 30 %.' },
  { key: 'fixed_yakeen_probe_down', name: 'Yakeen / ELM probe not answering', severity: 'P2', team: 'Digital Ops', segment: 'fixed', alert_class: 'technical',
    metric_key: 'fixed_yakeen_probe_down', operator: 'gte', threshold: 1, window_hours: 8, min_sample: 0,
    description: 'The latest scheduled / manual Yakeen probe (login + 4 ELM data calls) ended down or degraded.',
    runbook: '1) Troubleshoot → providers → Yakeen probe: which call failed and how (login vs data, timeout vs 5xx). 2) Login failing = credentials / ELM auth; data timing out = ELM capacity. 3) Re-run once (manual cap) after ELM confirms recovery so the alert clears.' },
];

/* ---- PER-CHANNEL × CLASS rule families (16 Sep 2026 — "like MVNO: every alert type per channel, business and
 * technical, accurate priority, latency"). Metrics live in fixedChannelMetrics.js and emit one snapshot row per
 * dim value; each rule below selects its row with dim {channel} / {channel, cls} / {kind} / {src}.
 * Priority doctrine (see that file's header): P1 = money at risk or a CUSTOMER channel failing wide / silent / 2×
 * latency / a provider hard down · P2 = technical degradation, latency over threshold, monitoring blind · P3 =
 * business anomalies (the platform works, customers are told no) · dealer-assisted SDA one notch under consumer
 * channels on business signals. Every rule is enabled; thresholds are PROVISIONAL until a week of live snapshots
 * (Alerts → rule → series) — tune the number, not the family. ---- */
const FXCH = {
  salamhome: { label: 'Salam Home app', consumer: true,  page: 'Salam Home app' },
  web:       { label: 'Epurchase',      consumer: true,  page: 'Epurchase' },
  qr:        { label: 'QR codes',       consumer: true,  page: 'Epurchase (QR)' },
  sda:       { label: 'SDA (dealer)',   consumer: false, page: 'SDA' },
  all:       { label: 'all channels',   consumer: true,  page: 'every channel' },
};
const BOARD_CH = ['salamhome', 'web', 'qr', 'sda', 'all'];
const APP_CH = ['salamhome', 'web', 'sda', 'all'];
const R = (o) => ({ team: 'Digital Ops', segment: 'fixed', window_hours: 1, min_sample: 0, ...o });
const bizTeam = ch => (ch === 'sda' || ch === 'qr' ? 'Sales Ops' : 'Digital Ops');
/* THRESHOLDS TUNED FROM 14 DAYS OF SNAPSHOTS (18 Sep 2026) — see claude/FIXED-ALERTS-TUNING.md.
 * The seed values were written before any series existed and landed BELOW the median: the web
 * technical rate fired at 15 % against a median of 33 %, so it was true on 93 % of ticks and simply
 * stayed open; web latency fired at 5 s against a median p95 of 7.3 s. A threshold under the median
 * is not a detector, it is a description of normal.
 * Each pair below is anchored on that signal's OWN distribution — P2 at about p95, P1 at about p99 —
 * so a P2 is true on roughly 5 % of ticks and a P1 on 1 %. The absolute, customer-facing numbers
 * these used to stand in for now live as Fixed SLO definitions (#slo-settings), which is the honest
 * split: an SLO says what we owe the customer, an alert says something changed. */
/* RE-ANCHORED 9 Oct 2026 (alpha.162) on the 14-day census of deploy152/fixed-alerts-review.cjs (sections 13–15) — see
 * claude/FIXED-ALERTS-TUNING.md. Two measurement faults were removed first, then the thresholds put on the corrected series:
 *   1. 82 % of the app steps counted TECHNICAL were business refusals by their own error line (a refused step logs a bare
 *      "mutation … fail" line, classed technical, beside the 400 error line). The collector now pairs them
 *      (fixedAppLogCollector.pairRows). Hourly technical rate, before → after, p50 / p95 / p99:
 *        Salam Home 19.0 / 34.6 / 43.2 %  →  0.0 / 1.9 / 5.2 %     SDA 21.7 / 41.5 / 62.3 %  →  1.2 / 5.6 / 15.3 %
 *        Epurchase  23.7 / 37.9 / 48.0 %  →  4.9 / 13.4 / 21.4 %
 *      The old 40–75 % thresholds sat ABOVE p99 of a series that was mostly refusals; on the corrected series they would
 *      never fire on a real outage. Now P2 ≈ 2× p99, P1 = a channel failing wide; ≥ 50 steps so a quiet hour cannot trip it.
 *   2. Steps slow EVERY day (createTicket, Epurchase confirmOtp — fixedChannelMetrics.SLOW_STEPS) decided the channel
 *      latency at low traffic. They have their own rule; the channel p95 without them, ≥ 60 steps, p95 / p99 of hours:
 *        Salam Home 7.9 / 12.5 s · SDA 10.4 / 15.1 s · Epurchase 11.8 / 14.3 s. P2 just above p99, P1 at 25 s.
 *      Latency is slowness, not downtime (execBrief.kindOf 'slow'): the P1 twin is kept for paging, it never reads Outage. */
const TUNED = {
  /* PER JOURNEY since alpha.169 — census section 18 (14 d to 9 Oct, hourly rate of journeys failed technically and not
   * completed, hours with ≥ 30 journeys), p50 / p95 / p99: Salam Home 0.0 / 2.1 / 5.6 % · Epurchase 7.1 / 15.3 / 26.5 % ·
   * SDA 1.5 / 5.0 / 8.6 % · all 4.7 / 10.5 / 21.2 %. At these thresholds the replay gives Salam Home 2 P2 episodes in 14 d
   * (one P1, 5 Oct 21:00 KSA, 27 %), Epurchase 4 (28 Sep and 8 Oct — the Unifonic quota days), no P1 storm on any channel
   * (they fired 18 times in 30 d on lines). SDA came down to 15 / 35 % (alpha.171): at 20 / 40 % it sat at 2.3× its p99
   * and never fired — a dealer channel failing for one journey in six is worth knowing. */
  applog_tech:    { salamhome: [0.10, 0.25], web: [0.25, 0.45], sda: [0.15, 0.35], all: [0.20, 0.40] },
  /* business refusal rate per journey (P3), ≈ 1.5× p99 of 14 d: Salam Home 18 / 34 / 42 % · Epurchase 9 / 24 / 29 % ·
   * SDA 12 / 23 / 45 % · all 13 / 22 / 26 %. At the old 65 % no channel reached it in 14 d — a refusal wall from a
   * configuration or data change (plan rules, ODB, a provider rule) would not have been seen (alpha.171). */
  applog_biz:     { salamhome: 0.60, web: 0.45, sda: 0.65, all: 0.40 },
  applog_tech_n:  50,
  applog_latency: { salamhome: [13000, 25000], web: [15000, 25000], sda: [15000, 25000], all: [15000, 25000] },
  applog_latency_n: 60,
  applog_otp:     { salamhome: 0.70, web: 0.35, sda: 0.45, all: 0.35 },
  applog_payment: { salamhome: 0.40, web: 0.40, sda: 0.40, all: 0.40 },
  board_tech:     { sda: [0.45, 0.90], all: [0.30, 0.50], web: [0.30, 0.50], qr: [0.40, 0.70] },   // p99 of 14 d: all 0.34 · web 0.31 · qr 0.67 (20 attempts an hour)
  board_tech_n:   30,
  board_surge:    { web: 85, qr: 110, salamhome: 85 },   // p99 of the business z — the board baseline under-reads (median z 8 / 5): STOPGAP, see the doc
  volume_floor:   { salamhome: 0.15, web: 0.15 },      // sda's ratio has a median of 0.11 — its baseline is wrong: the SDA rule is retired below
};
const CH_RULES = [];
for (const ch of BOARD_CH) {
  const c = FXCH[ch];
  const [p2, p1] = TUNED.board_tech[ch] || [c.consumer ? 0.15 : 0.20, c.consumer ? 0.40 : 0.50];
  CH_RULES.push(
    R({ key: `fixed_board_tech_rate_${ch}`, name: `${c.label} · technical error rate (P2)`, severity: 'P2', alert_class: 'technical', channel: ch,
      metric_key: 'fixed_board_fail_rate', dim: { channel: ch, cls: 'technical' }, operator: 'gte', threshold: p2, min_sample: TUNED.board_tech_n,
      description: `${c.label}: TECHNICAL errors on the error board (timeouts, OSS/BSS exceptions, 5xx, "[CC-…]" CRM codes, provider transport) ≥ ${Math.round(p2 * 100)} % of attempts in the last 60 min (≥ ${TUNED.board_tech_n} attempts) — counted as distinct JOURNEYS with such an error whose order was NOT processed (alpha.169: a retrying journey is one, a journey that still placed its order is an error to review). Board classification = catalogue overrides + the business/technical CASE, so reclassifying an error on the board moves it here too.`,
      runbook: `1) Fixed → Troubleshoot → Channel ${c.page} · Class Technical: the incident text names the top category and response. 2) Impact check with that response text: ongoing / recovering, since when, how many customers. 3) Provider named (TLS / DAWIYAT / STC / Yakeen…)? Check the provider rows and the probe; else the app team with request ids from the app-log lane. 4) Clears when the rate drops under ${Math.round(p2 * 100)} %.` }),
    R({ key: `fixed_board_tech_storm_${ch}`, name: `${c.label} · technical error storm (P1)`, severity: 'P1', alert_class: 'technical', channel: ch,
      metric_key: 'fixed_board_fail_rate', dim: { channel: ch, cls: 'technical' }, operator: 'gte', threshold: p1, min_sample: TUNED.board_tech_n,
      description: `${c.label}: ≥ ${Math.round(p1 * 100)} % of attempts in the last 60 min end in a TECHNICAL error — the channel is effectively down for customers${c.consumer ? '' : ' / dealers'}.`,
      runbook: `1) Page Digital Ops L2; open Troubleshoot → ${c.page} · Technical for the dominant category. 2) One category dominating = its dependency (OSS, BSS, provider) — page that on-call; many categories = platform / gateway / DB. 3) Sales / CX announcement while it lasts. 4) Downgrades to the P2 twin as the rate falls.` }),
    R({ key: `fixed_board_tech_anomaly_${ch}`, name: `${c.label} · technical errors above own baseline`, severity: 'P2', alert_class: 'technical', channel: ch,
      metric_key: 'fixed_board_fail_anomaly', dim: { channel: ch, cls: 'technical' }, operator: 'gte', threshold: 3.5, min_sample: 10,
      description: `${c.label}: TECHNICAL board errors in the last 60 min are ≥ 3.5 robust z above this channel's own 14-day baseline for this hour of day, and at least 10 errors more than usual (a quiet hour going from 0 to 4 is not an anomaly — alpha.162). Catches a rise the static rate rules miss on a busy channel.`,
      runbook: `1) The incident text says the count vs typical and the top category. 2) Troubleshoot → ${c.page} · Technical → error message select: which response multiplied. 3) Same steps as the technical-rate rule.` }),
    /* fixed_board_biz_anomaly_<channel> (P3) RETIRED 9 Oct 2026: 149 of the 782 Fixed fires in 30 days, true on 27–48 % of ticks —
     * the board business baseline under-reads (median z 14 on 'all'), and a business refusal rising is not a service fault.
     * The P2 business surge below stays as the one business signal on the board. init.js disables a retired key. */
    R({ key: `fixed_board_money_${ch}`, name: `${c.label} · paid but stuck (P2)`, severity: 'P2', team: 'BSS Ops', alert_class: 'technical', channel: ch,
      metric_key: 'fixed_board_money_at_risk', dim: { channel: ch }, operator: 'gte', threshold: 1,
      description: `${c.label}: at least one journey with an OPEN "paid — BSS not notified / order not created / payment failure" error in the last 60 min — a customer paid and got nothing. Per journey since alpha.169; a payment failure in a journey that then placed its order (paid on a retry) is not counted, while "BSS not notified" and "provision — no order" count even on a completed journey (the last screen does not prove BSS got the money).`,
      runbook: `1) Troubleshoot → ${c.page} → categories PAYMENT_NOT_NOTIFIED / PROVISION_NO_ORDER / PAYMENT_FAILED: the customer and workflow ids. 2) BSS: confirm the payment and re-notify / create the order manually. 3) Resolve the events on the board once the customer is served (the rule clears on resolved = true).` }),
    R({ key: `fixed_board_money_storm_${ch}`, name: `${c.label} · paid but stuck storm (P1)`, severity: 'P1', team: 'BSS Ops', alert_class: 'technical', channel: ch,
      metric_key: 'fixed_board_money_at_risk', dim: { channel: ch }, operator: 'gte', threshold: 5,
      description: `${c.label}: ≥ 5 open paid-but-stuck errors in 60 min — the payment → BSS / OSS hand-off is broken, money is accumulating at risk.`,
      runbook: `1) Page BSS + OSS on-call. 2) Check the payment webhook / notification path and OSS order creation for the channel. 3) Finance list of affected payments from the board export (XLSX, category filter). 4) Downgrades to the P2 twin as events are resolved.` }),
  );
  if (c.consumer && ch !== 'all') CH_RULES.push(
    R({ key: `fixed_board_biz_surge_${ch}`, name: `${c.label} · business refusal surge (P2)`, severity: 'P2', alert_class: 'business', channel: ch,
      metric_key: 'fixed_board_fail_anomaly', dim: { channel: ch, cls: 'business' }, operator: 'gte', threshold: TUNED.board_surge[ch] || 85, min_sample: 40,
      description: `${c.label}: business refusals ≥ ${TUNED.board_surge[ch] || 85} z above baseline (p99 of 14 days — the board business baseline under-reads, so the z is high every hour: a stopgap until it is fixed) with ≥ 40 in the hour — on a consumer channel a refusal wall this size is a configuration / data fault (wrong plan rules, ODB data, provider rule change), not customers.`,
      runbook: `1) Troubleshoot → ${c.page} · Business → error message select: one response dominating? 2) Roll back / fix the change with product / OSS. 3) CX heads-up while it lasts.` }),
  );
}
CH_RULES.push(
  R({ key: 'fixed_board_ingest_stale_ops', name: 'Read model stale · sda_ops (board blind)', severity: 'P1', alert_class: 'technical', window_hours: 24,
    metric_key: 'fixed_board_ingest_lag_min', dim: { src: 'ops' }, operator: 'gte', threshold: 120,
    description: 'No new order attempt or error on the prod read model (sda_ops) for ≥ 2 h — either the Fixed platform is silent or ops-ingest-watch stopped. Every board number and every board-based alert is blind while this lasts.',
    runbook: '1) On 152: pm2 status / logs of ops-ingest-watch (OOM during backfill = known — restart with a small DB_PAGE_SIZE). 2) If the ingest is fine, the platform itself is silent: check the app-log lane (combined.log) — if it is silent too, page the app team. 3) Clears when new rows land.' }),
  R({ key: 'fixed_board_ingest_stale_beta', name: 'Read model stale · sda_ops_beta (Epurchase + app served from prod)', severity: 'P2', alert_class: 'technical', window_hours: 24,
    metric_key: 'fixed_board_ingest_lag_min', dim: { src: 'beta' }, operator: 'gte', threshold: 120,
    description: 'The beta read model (Epurchase + Salam Home app) has no new row for ≥ 2 h. The board automatically falls back to prod for those channels (Salam Home app journeys then appear under Epurchase) — degraded, not blind.',
    runbook: '1) On 152: opsb-ingest-watch (crash-loop since 22 Aug 2026 — ticket). 2) Nothing to do on the board: the fallback is automatic. 3) Clears when beta writes again.' }),
);
for (const ch of APP_CH) {
  const c = FXCH[ch];
  const [p2, p1] = TUNED.applog_tech[ch] || [c.consumer ? 0.15 : 0.20, c.consumer ? 0.40 : 0.50];
  const lat = TUNED.applog_latency[ch] || [6000, 12000];
  CH_RULES.push(
    R({ key: `fixed_applog_tech_rate_${ch}`, name: `${c.label} · app steps failing technically (P2)`, severity: 'P2', alert_class: 'technical', channel: ch,
      metric_key: 'fixed_applog_fail_rate', dim: { channel: ch, cls: 'technical' }, operator: 'gte', threshold: p2, min_sample: TUNED.applog_tech_n,
      description: `${c.label}: ≥ ${Math.round(p2 * 100)} % of customer JOURNEYS in the app log (combined.log) had a step fail TECHNICALLY in the last 60 min and did not complete, on ≥ ${TUNED.applog_tech_n} journeys (5xx, timeouts, exceptions, unknown error — a refused step takes the class of its own error line, so "wrong password" or "no coverage" is business). Counted per journey (state id, else the request) since alpha.169: a customer retrying ten times is one journey, and a journey whose order was processed is not counted — its errors are listed as "errors to review".`,
      runbook: `1) Troubleshoot → From the app log → ${c.page} card: the failing step and reason (incident text has the last one). 2) Impact check with the reason text. 3) A single step failing for everyone (e.g. user.subscriptions "missing customerCode") = app team with request ids; many steps = platform. 4) Classify a wrongly-labelled reason in "Classify errors…" — the rule follows the catalogue.` }),
    R({ key: `fixed_applog_tech_storm_${ch}`, name: `${c.label} · app steps failing technically — storm (P1)`, severity: 'P1', alert_class: 'technical', channel: ch,
      metric_key: 'fixed_applog_fail_rate', dim: { channel: ch, cls: 'technical' }, operator: 'gte', threshold: p1, min_sample: TUNED.applog_tech_n,
      description: `${c.label}: ≥ ${Math.round(p1 * 100)} % of customer journeys hit a technical failure and did not complete — the channel is down or a core step (auth, subscriptions, feasibility, payment) is broken for everyone. Journeys whose order was processed are not counted.`,
      runbook: `1) Page Digital Ops L2 and the app team. 2) From the app log → ${c.page}: the dominant step; auth / me / subscriptions failing = login broken for all customers. 3) CX + Sales announcement. 4) Downgrades to the P2 twin as it recovers.` }),
    R({ key: `fixed_applog_biz_rate_${ch}`, name: `${c.label} · app steps refused (business)`, severity: 'P3', team: bizTeam(ch), alert_class: 'business', channel: ch,
      metric_key: 'fixed_applog_fail_rate', dim: { channel: ch, cls: 'business' }, operator: 'gte', threshold: TUNED.applog_biz[ch] || 0.65, min_sample: 50,
      description: `${c.label}: ≥ ${Math.round((TUNED.applog_biz[ch] || 0.65) * 100)} % of customer journeys in the last 60 min were REFUSED (wrong OTP, NIC mismatch, no coverage, plate not found, rate limit…) and did not complete, on ≥ 50 journeys — the platform answers, customers are being turned away. Per journey, orders processed apart (alpha.169).`,
      runbook: `1) From the app log → ${c.page}: the refusing step. 2) OTP / identity refusals en masse = a provider rule or data change; feasibility = ODB / coverage data. 3) Sales Ops if it is dealer behaviour.` }),
    R({ key: `fixed_applog_latency_${ch}`, name: `${c.label} · step latency p95 over ${lat[0] / 1000} s (P2)`, severity: 'P2', alert_class: 'technical', channel: ch,
      metric_key: 'fixed_applog_latency_p95_ms', dim: { channel: ch }, operator: 'gte', threshold: lat[0], min_sample: TUNED.applog_latency_n,
      description: `${c.label}: p95 duration of tRPC steps (from the "mutation … ms" lines in combined.log) ≥ ${lat[0]} ms over the last 60 min on ≥ ${TUNED.applog_latency_n} steps, the steps slow every day apart (their own rule). Latency climbs before timeouts — the early warning. Slowness, not downtime: the state reads Degraded.`,
      runbook: `1) The incident text names the slowest step and its p95. 2) One step slow = its dependency (provider, OSS/BSS call, DB) — check the matching provider row / api_calls host latency alert; every step slow = platform / DB / gateway on 146. 3) Tune the ms threshold here once a week of series exists. 4) Escalates to the ×2 P1 twin.` }),
    R({ key: `fixed_applog_latency_storm_${ch}`, name: `${c.label} · step latency p95 over ${lat[1] / 1000} s (P1)`, severity: 'P1', alert_class: 'technical', channel: ch,
      metric_key: 'fixed_applog_latency_p95_ms', dim: { channel: ch }, operator: 'gte', threshold: lat[1], min_sample: TUNED.applog_latency_n,
      description: `${c.label}: p95 step duration ≥ ${lat[1]} ms on ≥ ${TUNED.applog_latency_n} steps (known slow steps apart) — customers wait long enough to give up. Pages as P1; counts as slowness, not downtime (the technical-failure storm rule is what counts when steps time out).`,
      runbook: `1) Page Digital Ops L2 + the app team (146 / DB). 2) Slowest step in the incident text → its dependency first. 3) Watch the technical-rate rule for the same channel: timeouts follow latency.` }),
    R({ key: `fixed_applog_otp_tech_${ch}`, name: `${c.label} · OTP / verification failing technically`, severity: 'P2', alert_class: 'technical', channel: ch,
      metric_key: 'fixed_applog_otp_fail_rate', dim: { channel: ch, cls: 'technical' }, operator: 'gte', threshold: TUNED.applog_otp[ch] || 0.3, min_sample: 10,
      description: `${c.label}: of the journeys that reached an OTP / verification step (sendOTP, validateCode, verifyOtp, Absher checkValidateCode) in the last 60 min, ≥ ${Math.round((TUNED.applog_otp[ch] || 0.3) * 100)} % failed it TECHNICALLY and did not complete — SMS gateway (Unifonic quota), Absher or DRM not answering; nobody can log in or confirm. Per journey, orders processed apart (alpha.169).`,
      runbook: `1) From the app log → providers: Absher / DRM rows and the reason. 2) SMS gateway (Unifonic) balance / connectivity; Absher = provider. 3) Announce to CX: OTP delivery affected.` }),
    R({ key: `fixed_applog_otp_biz_${ch}`, name: `${c.label} · OTP / verification refused`, severity: 'P3', team: bizTeam(ch), alert_class: 'business', channel: ch,
      metric_key: 'fixed_applog_otp_fail_rate', dim: { channel: ch, cls: 'business' }, operator: 'gte', threshold: 0.65, min_sample: 30,
      description: `${c.label}: ≥ 65 % of OTP / verification steps refused on ≥ 30 steps (wrong code, expired, "too many requests", no mobile registered) — rate limiting or a broken retry loop in the app, or an attack pattern.`,
      runbook: `1) From the app log: the reason ("Too many requests…" = the app's own rate limit — check for a retry loop in the client). 2) Many refusals from one number / dealer = abuse → Fraud. 3) Otherwise informational.` }),
    R({ key: `fixed_applog_payment_tech_${ch}`, name: `${c.label} · payment / checkout failing technically (P1)`, severity: 'P1', team: 'BSS Ops', alert_class: 'technical', channel: ch,
      metric_key: 'fixed_applog_payment_fail_rate', dim: { channel: ch, cls: 'technical' }, operator: 'gte', threshold: TUNED.applog_payment[ch] || 0.2, min_sample: 20,
      description: `${c.label}: of the journeys that reached a payment / checkout / invoice step in the last 60 min, ≥ ${Math.round((TUNED.applog_payment[ch] || 0.2) * 100)} % failed it TECHNICALLY and did not complete (≥ 20 journeys) — money path broken: gateway, payment service or BSS invoice call. A journey that hit "Invalid order state" on checkPayment and then placed its order (wf_st_onnp2jwwbflv, 9 Oct) is an error to review, not a trigger (alpha.169).`,
      runbook: `1) From the app log → ${c.page}: checkPayment / payment steps and reason. 2) Payment gateway status; BSS invoice API; the payments worker lane (voidInvoice loop?). 3) Cross-check the "paid but stuck" board rule for the same channel — customers may have paid.` }),
    R({ key: `fixed_applog_payment_biz_${ch}`, name: `${c.label} · payment / checkout refused`, severity: 'P3', team: 'BSS Ops', alert_class: 'business', channel: ch,
      metric_key: 'fixed_applog_payment_fail_rate', dim: { channel: ch, cls: 'business' }, operator: 'gte', threshold: 0.65, min_sample: 20,
      description: `${c.label}: ≥ 65 % of the journeys at a payment step were refused (invalid order state, declined, outstanding due) and did not complete — usually a workflow-state or eligibility rule, sometimes a gateway declining en masse. Per journey, orders processed apart (alpha.169).`,
      runbook: `1) From the app log: the reason ("Invalid order state … expectedStep" = workflow desync → app team). 2) Declines en masse = gateway / bank side. 3) Informational otherwise.` }),
  );
}
CH_RULES.push(
  R({ key: 'fixed_applog_payments_worker_tech', name: 'Payments worker · failing technically', severity: 'P2', team: 'BSS Ops', alert_class: 'technical', channel: 'payments',
    metric_key: 'fixed_applog_fail_rate', dim: { channel: 'payments', cls: 'technical' }, operator: 'gte', threshold: 0.5, min_sample: 10,
    description: 'The payments service worker lines in combined.log (invoices.voidInvoice, notifications…) are failing ≥ 50 % in the last 60 min — a background job that will not succeed on its own (see also the retry-loop rule).',
    runbook: '1) From the app log → Payments worker card: the job and reason. 2) One ticket to the payments / app team with the invoice ids. 3) Not customer-facing by itself; check the paid-but-stuck rules for the customer impact.' }),
  R({ key: 'fixed_applog_step_latency_worst', name: 'Slowest app step p95 over 45 s', severity: 'P3', alert_class: 'technical',
    metric_key: 'fixed_applog_step_latency_p95_ms', operator: 'gte', threshold: 45000, min_sample: 20,
    description: 'The single slowest tRPC step (≥ 20 calls in the last 60 min, the known slow steps apart) has a p95 ≥ 45 s — one dependency is crawling even if the channel looks fine (feasibility to a provider, Yakeen, an OSS call). P3 since 9 Oct 2026: it was true on 5 % of ticks at 32 s (feasibility p99 35 s every day) — the channel latency rules carry the customer impact.',
    runbook: '1) The incident text names the step, channel and p95. 2) Map the step to its dependency: validateIndividualCustomer → Yakeen; feasibility → TLS / DAWIYAT / STC; checkPayment → gateway / BSS. 3) Check that provider\'s own latency / failure alert; raise with the provider or the app team.' }),
  /* the known slow steps, each against ITS OWN normal (alpha.162) — 3 h window, P3: a problem record, not a page */
  R({ key: 'fixed_applog_slow_createticket', name: 'Salam Home app · ticket creation p95 over 60 s', severity: 'P3', alert_class: 'technical', channel: 'salamhome', window_hours: 3,
    metric_key: 'fixed_applog_slow_step_p95_ms', dim: { path: 'salamApp.user.createTicket' }, operator: 'gte', threshold: 60000, min_sample: 5,
    description: 'salamApp.user.createTicket (Remedy ticket creation from the app) p95 ≥ 60 s over the last 3 h on ≥ 5 calls. Its normal is already slow — p95 30 s, p99 59 s over 14 days, ≥ 10 s on every day — and ~80 % of attempts are refused "duplicate of INC…" because customers tap again while waiting. Fires when it is worse than its own bad normal.',
    runbook: '1) The incident text gives p95, calls and refused / technical counts. 2) Remedy (ARSystem) response time with the Remedy owner; request ids from Troubleshoot → From the app log → Salam Home. 3) Problem record with the app team: a "creating your ticket" state, block the second tap, show the existing INC number on "duplicate".' }),
  R({ key: 'fixed_applog_slow_confirmotp_web', name: 'Epurchase · OTP confirmation p95 over 40 s', severity: 'P3', alert_class: 'technical', channel: 'web', window_hours: 3,
    metric_key: 'fixed_applog_slow_step_p95_ms', dim: { path: 'ePurchase.actions.confirmOtp' }, operator: 'gte', threshold: 40000, min_sample: 20,
    description: 'ePurchase.actions.confirmOtp p95 ≥ 40 s over the last 3 h on ≥ 20 calls. Its normal: p50 8.2 s, p95 22 s, p99 35 s over 14 days, ≥ 10 s every day — the OTP confirmation itself is slow (a problem record); this fires when it is worse than that.',
    runbook: '1) The incident text gives p95 and calls. 2) The OTP confirmation dependency (DRM / SMS / BSS customer lookup) — app team with request ids. 3) Watch Epurchase OTP technical failures: timeouts follow.' }),
  R({ key: 'fixed_applog_collector_stale', name: 'App-log collector stale (lane + app-log alerts blind)', severity: 'P2', alert_class: 'technical', window_hours: 24,
    metric_key: 'fixed_applog_collector_lag_min', operator: 'gte', threshold: 30,
    description: 'No new line from combined.log on 146 for ≥ 30 min while FIXED_LOG_HOSTS is configured — the ssh tail died, the key / user (console_ro) broke, or the app is silent. Every app-log alert (rates, latency, providers, OTP, payments) is blind meanwhile.',
    runbook: '1) On 152: pm2 logs salam-unified | grep APPLOG — ssh error? 2) ssh -i /root/.ssh/api_log_ed25519 console_ro@172.31.38.146 tail -1 /app/log/sda/combined.log — if the file moves, the collector is at fault (restart salam-unified); if not, the app is silent → app team. 3) Clears on the next line.' }),
);
/* fixed_applog_volume_collapse_sda RETIRED 9 Oct 2026: seeded OFF since 18 Sep but init.js never re-applies `enabled`, so it
 * kept firing (21 fires, true on 8 % of ticks, median ratio 0.11 on a broken baseline). Leaving the list disables it. */
for (const ch of ['salamhome', 'web']) {
  const c = FXCH[ch];
  CH_RULES.push(R({ key: `fixed_applog_volume_collapse_${ch}`, name: `${c.label} · traffic collapsed (silent outage)`, severity: c.consumer ? 'P1' : 'P2', alert_class: 'technical', channel: ch,
    metric_key: 'fixed_applog_volume_ratio', dim: { channel: ch }, operator: 'lte', threshold: TUNED.volume_floor[ch] || 0.25, enabled: ch !== 'sda', active_from: c.consumer ? 9 : 10, active_to: c.consumer ? 23 : 22,
    description: `${c.label}: customer journeys (${ch === 'salamhome' ? 'requests — the app logs almost no journey ids' : 'distinct journey ids'}) in the last 60 min are ≤ ${Math.round((TUNED.volume_floor[ch] || 0.25) * 100)} % of the median of the SAME trailing hour on the SAME KSA day type (Fri/Sat weekend vs Sun–Thu) over the last 4 weeks (KSA ${c.consumer ? '09–23' : '10–22'}, the hour normally ≥ 20) — the channel went quiet: an outage BEFORE the app (store, CDN, gateway, login page) shows up as silence, not as errors. Since alpha.169: it counted log LINES against a 7-day same-hour median that mixed weekdays into Fridays — Epurchase at 15:00 KSA has 64–85 journeys on a Friday and 200–330 on a weekday, so a normal Friday afternoon read "traffic collapsed" (the P1 of 9 Oct).`,
    runbook: `1) Open the ${c.page} yourself (or ask CX): does it load / log in? 2) Check the app-log collector rule (stale collector = same symptom) and the gateway / 146 health. 3) Compare the board ingest lag rule — both silent = platform-wide. 4) Clears when traffic returns.` }));
}
const KIND_LABEL = { yakeen: 'Yakeen / ELM (NIC record)', yakeen_address: 'Yakeen address (ELM)', absher: 'Absher OTP (DRM)', nafath: 'Nafath', semati: 'Semati (CITC)', manafith: 'Manafith', drm: 'DRM', naqeel: 'Naqeel (5G stock & delivery)', payment: 'Card capture / void / refund (payments v2)' };
for (const [kind, label] of Object.entries(KIND_LABEL)) {
  if (kind !== 'yakeen') CH_RULES.push(R({ key: `fixed_provider_tech_${kind}`, name: `${label} · technical failure rate (P2)`, severity: 'P2', alert_class: 'technical',
    metric_key: 'fixed_applog_provider_technical_rate', dim: { kind }, operator: 'gte', threshold: 0.3, min_sample: 5,
    description: `${label}: ≥ 30 % of calls in the app log failed TECHNICALLY (timeout, 5xx, transport) over the last 60 min with ≥ 5 calls — the provider is unstable; refusals ("no match", "no mobile registered") are business and excluded.`,
    runbook: `1) Troubleshoot → From the app log → providers → ${label}: the last technical reason. 2) Raise with the provider (ELM / Absher / CITC / Nafath); note the thread in the incident. 3) Sales: the identity / eligibility step fails for everyone — announce, stop retry loops. 4) Clears under 30 %.` }));
  CH_RULES.push(R({ key: `fixed_provider_down_${kind}`, name: `${label} · hard down (P1)`, severity: 'P1', alert_class: 'technical',
    metric_key: 'fixed_applog_provider_technical_rate', dim: { kind }, operator: 'gte', threshold: 0.7, min_sample: 10,
    description: `${label}: ≥ 70 % of ≥ 10 calls in the last 60 min failed technically — the provider is effectively down; every journey through it is blocked.`,
    runbook: `1) Page Digital Ops L2; provider escalation (ELM / Absher / CITC / Nafath) with the timestamps from the lane. 2) Sales + CX announcement: onboarding blocked at the identity / eligibility step. 3) Yakeen: run the probe to confirm from the console side (billed, capped). 4) Downgrades to the P2 twin as it recovers.` }));
}
CH_RULES.push(
  R({ key: 'fixed_api_host_tech_rate', name: 'Integration endpoint · technical failure rate (P2)', severity: 'P2', team: 'OSS Ops', alert_class: 'technical',
    metric_key: 'fixed_provider_api_fail_rate', dim: { host: '(worst)' }, operator: 'gte', threshold: 0.3, min_sample: 50,
    description: 'The worst outbound integration host in sda_ops.api_calls (feasibility / appointment / order calls to TLS, DAWIYAT, STC, SALAM, ACES, MOBILY…) has ≥ 30 % of its calls in the last 60 min ending in 5xx or a transport error (≥ 50 calls — at 10 the breaches came from hosts with a tenth of normal traffic). The incident text names the host.',
    runbook: '1) Fixed → Channel → Integrations: the host and endpoint family, p95 and failures. 2) 5xx from the provider = provider ticket; transport / timeouts from our side = network / gateway. 3) Board impact: the matching feasibility / appointment technical errors per channel.' }),
  R({ key: 'fixed_api_host_down', name: 'Integration endpoint · hard down (P1)', severity: 'P1', team: 'OSS Ops', alert_class: 'technical',
    metric_key: 'fixed_provider_api_fail_rate', dim: { host: '(worst)' }, operator: 'gte', threshold: 0.6, min_sample: 50,
    description: 'The worst integration host has ≥ 60 % technical failures on ≥ 20 calls in the last 60 min — feasibility / appointment / order creation is blocked for the journeys that depend on it.',
    runbook: '1) Page OSS Ops; provider escalation with the host and timestamps. 2) Sales announcement for the affected provider footprint (regions). 3) Downgrades to the P2 twin as it recovers.' }),
  R({ key: 'fixed_api_host_latency', name: 'Integration endpoint · p95 latency over 10 s (P2)', severity: 'P2', team: 'OSS Ops', alert_class: 'technical',
    metric_key: 'fixed_provider_api_latency_p95_ms', dim: { host: '(worst)' }, operator: 'gte', threshold: 10000, min_sample: 50,
    description: 'The slowest outbound integration host has a p95 ≥ 10 s over the last 60 min (≥ 50 calls; p99 of 14 days is 9.3 s). Provider latency is what turns into feasibility timeouts and dealer timeout waves. Threshold PROVISIONAL.',
    runbook: '1) Fixed → Channel → Integrations: host, family, p95 / max. 2) Provider capacity ticket if it persists; check the dealer-timeout rules. 3) Tune the ms once a week of series exists.' }),
  R({ key: 'fixed_api_host_latency_storm', name: 'Integration endpoint · p95 latency over 15 s (P1)', severity: 'P1', team: 'OSS Ops', alert_class: 'technical',
    metric_key: 'fixed_provider_api_latency_p95_ms', dim: { host: '(worst)' }, operator: 'gte', threshold: 15000, min_sample: 50,
    description: 'The slowest integration host has a p95 ≥ 15 s — calls are hitting the app timeouts; journeys through this provider fail.',
    runbook: '1) Page OSS Ops + provider. 2) Expect the technical-rate rules for the same provider footprint to follow. 3) Downgrades to the P2 twin as it recovers.' }),
);
/* NEXUS MONEY / STOCK WATCH (7 Oct 2026 — salam-nexus 30 Sep review, claude/FIXED-NEXUS-REVIEW-2026-10-07.md).
 * Metrics in fixedEpWatch.js read nexus directly: the read models never see the Naqeel order, the manual capture, the
 * delivery-time BSS order, the return-to-origin refund or the SIM / landline locks. Baseline measured 7 Oct: 8 paid 5G
 * journeys in 3 weeks (2 provisioned, 2 refunded, 5 without a BSS order ≥ 3 d), 74 leaked locks, 39 AUTHORIZED FTTH rows,
 * 90 % of 5G journeys ending at the location / stock step. Page: Fixed › Payments watch. */
const EPW = [
  R({ key: 'fixed_ep5g_paid_no_bss_order', name: '5G e-purchase · paid, no BSS order after 72 h', severity: 'P2', alert_class: 'business', window_hours: 24,
    metric_key: 'fixed_ep5g_paid_no_bss_order', operator: 'gte', threshold: 1,
    description: 'A 5G HomeFi e-purchase journey was paid (card captured) and the Naqeel delivery order placed ≥ 72 h ago, but no BSS order exists — or the BSS order created at delivery (Naqeel event 7) failed. The backend creates the subscription only on that webhook and does not retry: the customer may hold a delivered device with no service.',
    runbook: '1) Fixed › Payments watch → 5G paid journeys → "Paid, no BSS order": journey id, Naqeel waybill. 2) Ask Naqeel for the shipment status (delivered / in transit). 3) Delivered → Fixed squad creates the BSS order (createOrderNew5g) by hand; in transit > 5 d → Naqeel escalation. 4) Clears when the real order number lands in the journey.' }),
  R({ key: 'fixed_ep5g_naqeel_fail_charged', name: '5G e-purchase · Naqeel order failed but the card was charged (P1)', severity: 'P1', alert_class: 'business', window_hours: 24,
    metric_key: 'fixed_ep5g_naqeel_fail_charged', operator: 'gte', threshold: 1,
    description: 'The Naqeel delivery order failed and the invoice is CAPTURED / PAID — the void did not happen. Money taken, nothing shipped.',
    runbook: '1) Payments watch → the journey → invoice. 2) Finance: refund (payments v2 refundInvoice). 3) Inventory: release the SIM / landline lock. 4) Report to the Fixed squad (capture-after-failure path).' }),
  R({ key: 'fixed_ep5g_rto_refund_missing', name: '5G e-purchase · returned to origin, refund missing (P1)', severity: 'P1', alert_class: 'business', window_hours: 24,
    metric_key: 'fixed_ep5g_rto_refund_missing', operator: 'gte', threshold: 1,
    description: 'Naqeel reported the shipment returned (event 9 / 113) but no refund is recorded on the journey — the refund call failed (the backend only logs it).',
    runbook: '1) Payments watch → "Returned to origin — refund missing". 2) Finance refunds the captured payment. 3) Inventory releases the stock. 4) Clears when invoice.refund is written.' }),
  R({ key: 'fixed_ep5g_paid_stopped', name: '5G e-purchase · paid, journey stopped before the Naqeel order', severity: 'P2', alert_class: 'business', window_hours: 24,
    metric_key: 'fixed_ep5g_paid_stopped', operator: 'gte', threshold: 1,
    description: 'A 5G e-purchase journey holds an AUTHORIZED / CAPTURED / PAID invoice but stopped before the OTP step that places the Naqeel order (≥ 1 h). Authorised = the 10-min loop should void it; captured = money taken without an order.',
    runbook: '1) Payments watch → "Paid, journey stopped before the Naqeel order". 2) Authorised → confirm it is voided in payments; captured → refund or complete the order with the customer. 3) Fixed squad if it repeats (capture-throw path).' }),
  R({ key: 'fixed_ep5g_lock_leak', name: '5G stock · SIM / landline locks never released', severity: 'P3', alert_class: 'business', window_hours: 24,
    metric_key: 'fixed_ep5g_lock_leak', operator: 'gte', threshold: 5,
    description: '≥ 5 SIM (ICCID) / landline (MSISDN) locks taken at the 5G e-purchase location step are still LOCKED on journeys expired > 2 h. Cancelling does not release them and the backend release sweep has no scheduler — sellable stock shrinks.',
    runbook: '1) Payments watch → Stock locks (Show full serials, audited). 2) Inventory / BSS team releases them (lockOrUnlockResource R). 3) Fixed squad: schedule the unlockDevices sweep and release on cancel.' }),
  R({ key: 'fixed_ep_auth_stuck', name: 'E-purchase · card authorisations neither captured nor voided', severity: 'P2', alert_class: 'business', window_hours: 24,
    metric_key: 'fixed_ep_auth_stuck', operator: 'gte', threshold: 1,
    description: 'epurchase_payments rows still AUTHORIZED on journeys expired > 60 min. The backend 10-min loop captures (order exists) or voids them; a hold that stays means the customer\'s card is blocked or the order is unpaid. The row can be stale — confirm in payments.',
    runbook: '1) Payments watch → Card holds: journey, invoice, "order in context". 2) Payments v2: actual invoice status. 3) Still AUTHORIZED there → capture (order exists) or void (no order) by hand; ask the Fixed squad why the loop skipped it.' }),
  R({ key: 'fixed_ep_ftth_paid_no_order', name: 'E-purchase FTTH · charged before the order, no later order (verify first)', severity: 'P2', alert_class: 'business', window_hours: 24, enabled: false,
    metric_key: 'fixed_ep_ftth_paid_no_order', operator: 'gte', threshold: 1,
    description: 'FTTH e-purchase journeys holding a PAID / CAPTURED invoice that expired at verification or OTP (the step that creates the order) and whose customer never reached the order step later. Seeded OFF: the volume (thousands over 60 days) must first be reconciled with Finance / back-office order creation.',
    runbook: '1) Payments watch → FTTH charged before the order. 2) Sample 10 journeys with Finance: refunded? order created in back-office? 3) Enable the rule once the definition is confirmed.' }),
  R({ key: 'fixed_ep_webhook_fail', name: 'Payment webhooks failing (P2)', severity: 'P2', alert_class: 'technical',
    metric_key: 'fixed_ep_webhook_fail', dim: { source: '(worst)' }, operator: 'gte', threshold: 3,
    description: '≥ 3 payment webhooks (Sadad / e-purchase / Salam Home) failed or never finished in the last 60 min for one source — paid invoices are not being applied to the journey / BSS.',
    runbook: '1) Payments watch → Payment webhooks: source, last failures. 2) Payments v2 + the Fixed app log (Troubleshoot › From the app log). 3) Replay the failed webhooks once fixed.' }),
  R({ key: 'fixed_ep5g_location_stop', name: '5G e-purchase · most journeys end at the location / stock step', severity: 'P3', alert_class: 'business', window_hours: 24,
    metric_key: 'fixed_ep5g_location_stop_rate', operator: 'gte', threshold: 0.8, min_sample: 10,
    description: '≥ 80 % of the 5G e-purchase journeys that ended in the last 24 h (≥ 10) stopped at the location step — no coverage, no Naqeel stock, or the SIM Naqeel reserved is not sellable in BSS (simState ≠ I). 7 Oct baseline: 90 %.',
    runbook: '1) Payments watch → Location step · SIM check: the simState mix. 2) Not I → Naqeel / BSS inventory sync (Supply Chain). 3) Troubleshoot › app log → Naqeel lane for "no skus" / "Sim card is not available".' }),
];
for (const r of EPW) CH_RULES.push(r);
/* INFRASTRUCTURE rules (30 Sep 2026): one set per side, owner infra-l2 (Fixed) / mobile-digital-l2 (Mobile, until a Mobile infra responder is named) */
const INFRA_RULES = (seg) => { const p = seg === 'fixed' ? 'fixed_' : ''; const team = seg === 'fixed' ? 'infra-l2' : 'mobile-digital-l2'; const side = seg === 'fixed' ? 'Fixed' : 'Mobile'; const extra = seg === 'fixed' ? { segment: 'fixed' } : {};
  return [
    { key: `${p}infra_host_unreachable`, name: `Infra · host unreachable — ${side} (P1)`, severity: 'P1', team, alert_class: 'technical', metric_key: `${p}infra_hosts_down`, operator: 'gte', threshold: 1, window_hours: 1, min_sample: 1, ...extra,
      description: `A ${side} host of the HLD answers on NO source the console has — no ssh, no service port, no node exporter, no Instana — for a full tick. One host is enough. Sources are read-only probes from the console box; the value is the count of such hosts at the last tick.`,
      runbook: '1) Infrastructure › Hosts → the host page: which probes failed and since when (Changes shows the status flip). 2) Check the console box can reach the host at all (ping / firewall) before calling the host down. 3) If the service VIP still answers (LB / MaxScale rows OK) the customer impact is nil — downgrade to P3 and open the change with the infra team; otherwise page the owner team.' },
    { key: `${p}infra_port_down`, name: `Infra · service port down — ${side} (P2)`, severity: 'P2', team, alert_class: 'technical', metric_key: `${p}infra_ports_down`, operator: 'gte', threshold: 1, window_hours: 1, min_sample: 1, ...extra,
      description: `A service port of a ${side} host (443/80 on an edge, 3306/5432 on a database, the port printed on the HLD card) does not accept a TCP connection from the console box while the host itself is reachable. Value = number of closed service ports at the last tick.`,
      runbook: '1) Host page → Ports: which port, since when. 2) A single node of a pair (GW01/GW02, App .136-.139) behind a VIP is capacity, not outage: confirm the VIP row is OK. 3) A VIP or database port down is an outage: page the owner, check the Journey health strip for the business effect.' },
    { key: `${p}infra_disk_full`, name: `Infra · disk ≥ 90 % — ${side} (P2)`, severity: 'P2', team, alert_class: 'technical', metric_key: `${p}infra_disk_pct_max`, operator: 'gte', threshold: 90, window_hours: 1, min_sample: 1, ...extra,
      description: `The fullest filesystem across the ${side} hosts is at 90 % or more (df, tmpfs/overlay excluded). A full disk on an app or database host stops logging first, then the service.`,
      runbook: '1) Host page → Disks: which mount. 2) Logs (/var/log, app log dirs, pm2 logs) are the usual cause — rotate, do not delete blindly. 3) Database mounts: involve the DBA before touching anything; a DB disk at 95 % is a P1 in practice.' },
    { key: `${p}infra_memory_high`, name: `Infra · memory ≥ 95 % — ${side} (P2)`, severity: 'P2', team, alert_class: 'technical', metric_key: `${p}infra_mem_pct_max`, operator: 'gte', threshold: 95, window_hours: 1, min_sample: 1, ...extra,
      description: `The worst ${side} host holds 95 % or more of its memory (MemTotal − MemAvailable, the page cache is not counted). Sustained 95 % precedes the OOM killer.`,
      runbook: '1) Host page → memory sparkline: a slow climb is a leak (restart the process at the next window), a step is a new load. 2) The healthcheck mail names the largest processes. 3) Add RAM only after the leak is excluded.' },
    { key: `${p}infra_load_high`, name: `Infra · load per core ≥ 2.5 — ${side} (P3)`, severity: 'P3', team, alert_class: 'technical', metric_key: `${p}infra_load_per_core_max`, operator: 'gte', threshold: 2.5, window_hours: 1, min_sample: 1, ...extra,
      description: `The 15-minute load average of the busiest ${side} host is at least 2.5 × its cpu count — the box has been saturated for a quarter of an hour, requests queue.`,
      runbook: '1) Host page: load vs cpu% — high load with low cpu is I/O wait (disk, NFS, a stuck mount). 2) Correlate with the API latency rules of the same side. 3) A batch / backup window that recurs at the same hour is a scheduling issue, not capacity.' }
  ]; };
for (const r of INFRA_RULES('mobile')) RULES.push(r);
for (const r of INFRA_RULES('fixed')) FIXED_RULES.push(r);
for (const r of CH_RULES) FIXED_RULES.push(r);
for (const r of FIXED_RULES) {
  if (!r.key.startsWith('fixed_') || !r.metric_key.startsWith('fixed_')) throw new Error(`fixed rule ${r.key} must use fixed_ keys`);
  if (!METRICS[r.metric_key]) throw new Error(`fixed rule ${r.key}: unknown metric ${r.metric_key}`);
  RULES.push(r);
}

module.exports = { CATALOG, RULES };
