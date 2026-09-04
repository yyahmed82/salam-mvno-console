# Quizzes — with answer keys
Run each quiz **live** (hands up / call out), not on paper — the debrief is where the learning happens.
Give 30–45 seconds per question, then discuss. Questions marked ⭐ are the ones that matter most;
if the room gets those wrong, re-teach before moving on.

Facilitator tip: **ask "why?" after every correct answer.** A right answer for the wrong reason is a
wrong answer that hasn't failed yet.

---

# QUIZ 1 — Foundations (Day 1) · pass 7/10

**1.** Where does the console read its data from?
a) Production directly · b) A replica synced from prod · c) A nightly CSV · d) The BSS

**2.** ⭐ How fresh is the data, normally?
a) Real time · b) ~5 minutes · c) 1 hour · d) Yesterday

**3.** Can the console change anything in production?
a) Yes, it can refund payments · b) Yes, with Super Admin · c) No — it is read-only against prod · d) Only activations

**4.** ⭐ Who can unmask customer PII?
a) Anyone logged in · b) Any L2 · c) Only Super Admin and L3 Digital · d) Nobody

**5.** What happens when you unmask PII?
a) Nothing special · b) It's written to the audit log with your name · c) The customer is notified · d) It's stored for later

**6.** You sign in with…
a) A shared team password · b) Your @salam.sa email + a one-time code · c) Your BSS account · d) A VPN certificate

**7.** ⭐ The dashboard shows a red banner saying data is behind. What do you do?
a) Ignore it, the numbers look fine · b) Refresh until it goes away · c) Treat every figure as not live and say so before quoting it · d) Restart the console

**8.** A KPI is coloured red. That means…
a) The system is broken · b) It's below its SLA target · c) There's no data · d) An alert fired

**9.** Your role determines…
a) Only the colour scheme · b) Which pages you see and what you can do · c) Nothing, everyone sees everything · d) Only export rights

**10.** The journey-health strip shows eight journeys. Which is NOT one of them?
a) Payments · b) Activation · c) Delivery · d) Billing disputes

### Answer key — Quiz 1
| # | Ans | Why it matters |
|---|---|---|
| 1 | **b** | Isolation: heavy queries never touch the system serving customers. |
| 2 | **b** | ~5 min is *normal*, not a fault. Sets the right expectation for "live". |
| 3 | **c** | The prod connection is forced read-only. The console observes; humans act. |
| 4 | **c** | Least privilege is enforced in code, not by policy. |
| 5 | **b** | Accountability — this is what makes unmasking safe to grant at all. |
| 6 | **b** | No shared credentials; domain-locked to work email. |
| 7 | **c** | ⭐ The most dangerous state is *wrong-but-plausible* numbers. |
| 8 | **b** | Colour is relative to the target, not to zero. |
| 9 | **b** | Pages literally don't render for roles that lack them. |
| 10 | **d** | The eight are Onboarding, Eligibility·Gov, Identity, Payments, Activation, Delivery, Change Plan, Ownership. |

---

# QUIZ 2 — Troubleshooting & incidents (Day 2) · pass 9/12

**1.** ⭐ A payment is `pending`, 45 minutes old, **with** a gateway commit response. This is…
a) Abandoned by the customer · b) Stuck — possibly charged, not confirmed · c) A duplicate · d) Normal

**2.** ⭐ Same, but with **no** commit response. This is…
a) Stuck, escalate now · b) The customer never completed the payment page · c) A gateway outage · d) A refund

**3.** Why does the duplicate tile say "suspected"?
a) The developers were unsure · b) Confirmation requires gateway reconciliation · c) It's a beta feature · d) It's always wrong

**4.** ⭐ Blended payment success is 84% and looks healthy. UPG is actually dead. How is that possible?
a) The dashboard is broken · b) Traffic failed over to another gateway, so successes still appear · c) 84% is bad · d) UPG isn't included

**5.** What catches that situation?
a) The payment failure storm rule · b) The per-gateway zero-success watchdog · c) The SLA page · d) Nothing

**6.** Semati fails ~55% on a completely normal day. So an alert should fire when…
a) Failures exceed 10% · b) Any failure occurs · c) Failure rises meaningfully above that baseline · d) Never

**7.** ⭐ What does acknowledging an incident actually do?
a) Marks it resolved · b) Stops the escalation ladder from climbing · c) Emails the customer · d) Nothing, it's cosmetic

**8.** Correlation/suppression exists so that…
a) Fewer alerts are stored · b) One provider outage pages once as a root cause instead of ten times · c) Alerts are hidden · d) The DB stays small

**9.** You search a customer and see their number as `05••••••89`. Why?
a) A bug · b) PII masking for your role · c) The number is invalid · d) The data is stale

**10.** The runbook for an incident lives…
a) In a wiki · b) In the WhatsApp group · c) Attached to the alert itself · d) In someone's head

**11.** A customer was charged twice. What can you promise on the spot?
a) An immediate refund · b) That it will be verified against the gateway and the extra capture refunded · c) Nothing at all · d) A new SIM

**12.** ⭐ Which of these is an *incident*, not a customer case?
a) One customer's card was declined · b) One customer abandoned checkout · c) Twenty customers failing the same step in ten minutes · d) A customer forgot their password

### Answer key — Quiz 2
| # | Ans | Why it matters |
|---|---|---|
| 1 | **b** | ⭐ Commit response present = the gateway answered = money may have moved. |
| 2 | **b** | ⭐ No commit = they never finished. Refunding these is a real, costly mistake. |
| 3 | **b** | Intellectual honesty — the app DB can't see the gateway's second capture. |
| 4 | **b** | ⭐ The failover trap. INC0014859 in one question. |
| 5 | **b** | Per-gateway, not blended. |
| 6 | **c** | "Alert on change from normal, not on the baseline." |
| 7 | **b** | ⭐ Ack is operational, not paperwork. |
| 8 | **b** | Alert storms cause people to ignore alerts. |
| 9 | **b** | Masking is the default for every role except Super Admin / L3 Digital. |
| 10 | **c** | Nobody should hunt a wiki at 3am. |
| 11 | **b** | Never promise a refund from the suspicion screen alone. |
| 12 | **c** | Volume + same step + short window = incident. Escalate, don't case-by-case it. |

---

# QUIZ 3 — Analytics, tuning & platform (Day 3) · pass 9/12

**1.** An SLO says "at risk". That means…
a) It's already breached · b) It's still met but the error budget is nearly used · c) There's no data · d) The target is wrong

**2.** ⭐ Reseller channel numbers must be attributed from…
a) `plan_channels` (which channels *may* sell a plan) · b) The order's own recorded origin · c) UTM only · d) Manual entry

**3.** Why does (a) above give wrong answers?
a) It's slow · b) A plan can be enabled on many channels, so one order gets counted many times · c) It's not synced · d) It has no index

**4.** ⭐ Before changing an alert threshold you should…
a) Guess a round number · b) Look at the metric chart and its seasonal band · c) Disable the rule first · d) Ask the vendor

**5.** "Test now" on a rule does what?
a) Sends a test email · b) Evaluates the rule against current live data without saving · c) Creates a fake incident · d) Restarts the engine

**6.** An alert cries wolf every night at 03:00. The best fix is usually…
a) Delete the rule · b) Disable it overnight forever · c) Raise the min-sample gate so low volume can't trigger it · d) Ignore it

**7.** The response cache serves a 30-day dashboard in milliseconds because…
a) It pre-computes at midnight · b) It caches with stale-while-revalidate; only the first caller waits · c) It samples the data · d) It uses a smaller table

**8.** ⭐ Everything (server, DB sessions) runs in **UTC**. Why does that matter?
a) It doesn't · b) Timestamps are stored as UTC in naive columns — a non-UTC session shifts every window · c) For log formatting · d) Legal requirement

**9.** The MNP donor breakdown tells you…
a) Which operator's customers are switching to us, and how many complete · b) Our churn · c) Tower coverage · d) Revenue

**10.** Low activation rate on one specific donor operator suggests…
a) No demand from that operator · b) Porting friction with that operator · c) A billing error · d) Nothing

**11.** Yusr (the AI assistant) sends your data…
a) To OpenAI · b) Nowhere — the model runs on-premise · c) To Teams · d) To the vendor

**12.** What does Yusr show you that respects your role?
a) Everything, unmasked · b) Context masked to your own permissions · c) Only public data · d) Nothing personal ever

### Answer key — Quiz 3
| # | Ans | Why it matters |
|---|---|---|
| 1 | **b** | Error budget is the early-warning mechanism — act before the breach. |
| 2 | **b** | ⭐ This bug inflated an unlaunched channel to 311 orders (real: 65). |
| 3 | **b** | Join fan-out. "May sell" ≠ "did sell". |
| 4 | **b** | ⭐ Look first, change second. |
| 5 | **b** | Safe experimentation before you commit. |
| 6 | **c** | Keep coverage, remove noise. Deleting creates a silent blind spot. |
| 7 | **b** | Only the first caller after a sync pays the cost. |
| 8 | **b** | ⭐ This exact bug made the dashboard show zeros while data was fine. |
| 9 | **a** | Commercial insight from operational data. |
| 10 | **b** | It's a process problem to fix, not a market fact to accept. |
| 11 | **b** | On-premise: data never leaves the network. |
| 12 | **b** | The LLM only ever sees what the asker is allowed to see. |

---

## Scoring sheet

| Attendee | Q1 /10 | Q2 /12 | Q3 /12 | Practical (A + D) | Certified |
|---|---|---|---|---|---|
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |

**Certified** = 7/10 + 9/12 + 9/12 **and** completed Scenario A and Scenario D unaided.
Anyone short: 30-minute follow-up on the specific gap — don't re-run the whole day.
