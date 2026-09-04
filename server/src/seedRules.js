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
  { key: 'nafath_fail_storm', name: 'Nafath failure storm (P1)', severity: 'P1', team: 'Digital Ops',
    alert_class: 'business',  // EXPIRED/REJECTED/DENIED are well-formed \"no\"s from Nafath (errclass BIZ_TEXT)
    metric_key: 'nafath_fail_rate', operator: 'gte', threshold: 0.50, window_hours: 1, min_sample: 20,
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
  { key: 'citc_upstream_down_business', name: 'CITC upstream degraded — Nafath side (P1)', severity: 'P1', team: 'Digital Ops',
    alert_class: 'business',  // Nafath EXPIRED/REJECTED/DENIED — well-formed refusal outcomes
    // PROVISIONAL — calibrate against live: inherits the composite's 0.40 (between nafath_fail_spike
    // 0.25 and nafath_fail_storm 0.50, but on a 30-min window).
    metric_key: 'nafath_fail_rate', operator: 'gte', threshold: 0.40, window_hours: 0.5, min_sample: 10,
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
    metric_key: 'payment_fail_rate', operator: 'gte', threshold: 0.30, window_hours: 3, min_sample: 40,
    description: 'Payment failure rate elevated above the ~19% baseline over 3h (early degradation).',
    runbook: '1) Payment failures elevated over 3h — early degradation, not yet a storm. 2) Troubleshoot → Payment: check the leading gateway and top decline code. 3) Watch for it crossing the P1 storm threshold. 4) Sample a few declines to rule out a systemic code.' },
  { key: 'payment_web_fail', name: 'Web checkout failure spike (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'business',  // web decline-rate — gateway answered \"no\"
    metric_key: 'payment_fail_rate', operator: 'gte', threshold: 0.35, window_hours: 3, min_sample: 50,
    dim: { platform: 'web' }, description: 'Web e-purchase payment failures elevated — isolate from app.',
    runbook: '1) Web checkout failures elevated (isolated from app). 2) Troubleshoot → Payment, filter platform=web: check the web gateway / 3DS redirect flow. 3) Compare with the app failure rate — if app is healthy, it is a web-checkout/redirect issue. 4) Engage the web/checkout owner.' },
  { key: 'nafath_fail_spike', name: 'Nafath failure spike (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'business',  // Nafath refusal outcomes (expired/rejected)
    metric_key: 'nafath_fail_rate', operator: 'gte', threshold: 0.25, window_hours: 1, min_sample: 40,
    description: 'Identity verification (Nafath) failing ≥25% in the last hour — early degradation on the onboarding-critical path.',
    runbook: '1) Nafath failing ≥25%/1h — early degradation on the onboarding path. 2) Troubleshoot → Nafath: confirm the failure type. 3) Watch toward the 50% storm threshold; correlate with the CITC composite. 4) Pre-warn the IAM/Absher owner if it is climbing.' },
  { key: 'semati_fail_spike', name: 'Semati provisioning failure spike (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'business',  // provisioning refusals (MOBILE_EXISTS / SEMATI_FAILED); 715/transport excluded from the metric
    metric_key: 'semati_fail_rate', operator: 'gte', threshold: 0.65, window_hours: 24, min_sample: 20,
    description: 'MSISDN provisioning failing above the ~55% baseline — SEMATI_FAILED / MOBILE_EXISTS.',
    runbook: '1) Semati provisioning above baseline over 24h — mostly MOBILE_EXISTS / SEMATI_FAILED business failures. 2) Troubleshoot → Semati: confirm it is business (not 715/transport). 3) If MOBILE_EXISTS dominates, review the number pool / duplicate-order logic. 4) Not a provider outage unless the Semati provider alerts also fire.' },
  { key: 'eligibility_deny_spike', name: 'Eligibility denials (P2)', severity: 'P2', team: 'Sales Ops',
    alert_class: 'business',  // CITC answered DENIED — provider errors are already excluded from the metric
    metric_key: 'eligibility_deny_rate', operator: 'gte', threshold: 0.50, window_hours: 24, min_sample: 50,
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
    metric_key: 'recharge_fail_rate', operator: 'gte', threshold: 0.30, window_hours: 3, min_sample: 40,
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
  { key: 'offhours_orders', name: 'Off-hours unusual activity (P2)', severity: 'P2', team: 'Digital Ops',
    alert_class: 'business',  // activity anomaly (test/automation/fraud) — not an error class at all
    metric_key: 'offhours_orders', operator: 'gte', threshold: 30, window_hours: 3, min_sample: 0,
    active_from: 1, active_to: 6, description: 'Order attempts during the 01:00–06:00 KSA dead window (test/automation/fraud).',
    runbook: '1) Order attempts in the KSA dead window — usually test/automation, occasionally fraud. 2) Troubleshoot: inspect the sources/IPs and whether the orders complete. 3) A burst from one source → flag for fraud/security review. 4) Benign if it is known automation.' },
  { key: 'dealer_activity_drop', name: 'Working-hours dealer activity drop (P2)', severity: 'P2', team: 'Sales Ops',
    alert_class: 'technical',  // channel-silence watchdog — a feed/platform outage is the actionable cause (demand drop is the caveat)
    metric_key: 'dealer_activity', operator: 'lte', threshold: 2, window_hours: 6, min_sample: 0,
    active_from: 9, active_to: 22, description: 'Dealer (DMS) completed-order volume collapsed during dealer hours (data-dependent — dealer feed may be absent in the replica).',
    runbook: '1) Dealer (DMS) completed-order volume collapsed in dealer hours. 2) First check data: the dealer feed may be absent/lagged in the replica (known caveat) — confirm against a live source. 3) If real, contact dealer-channel ops. 4) Do not page if it is a known feed gap.' },

  // ---------- P3 : watch ----------
  { key: 'abandoned_orders', name: 'Abandoned onboarding surge (P3)', severity: 'P3', team: 'Sales Ops',
    alert_class: 'business',  // abandonment = customer outcome; the platform answered every step it was asked
    metric_key: 'onboarding_abandoned', operator: 'gte', threshold: 12000, window_hours: 24, min_sample: 0,
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
    metric_key: 'fixed_workhours_activity_ratio', operator: 'lte', threshold: 0.5, window_hours: 3, min_sample: 10, active_from: 15, active_to: 22, params: { baselineDays: 7 },
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
    runbook: '1) Review the SLA-missed tickets by assigned group. 2) Raise with the owning group lead; adjust OLA if systematic.' }
];
for (const r of FIXED_RULES) {
  if (!r.key.startsWith('fixed_') || !r.metric_key.startsWith('fixed_')) throw new Error(`fixed rule ${r.key} must use fixed_ keys`);
  if (!METRICS[r.metric_key]) throw new Error(`fixed rule ${r.key}: unknown metric ${r.metric_key}`);
  RULES.push(r);
}

module.exports = { CATALOG, RULES };
