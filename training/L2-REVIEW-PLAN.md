# Digital Console — L2 Review Series

**Three sessions on three consecutive days, starting today · plus a short stand-up on the days between**

This is not training. L2 are the reviewers. By Friday we need three decisions:

1. Are the numbers **true**?
2. Are the alerts **right**?
3. Is the console **useful** in a real incident?

L1 workshops start only after this closes. If that means a delay, the delay is the right call —
L1 will believe whatever the console tells them, so it has to be right before they see it.

---

## Why L2 first

| | |
|---|---|
| **L1 can't spot a wrong number** | They'll quote it to a customer or close a case on it. You can tell. |
| **You know what normal looks like** | Semati failing 55% on a quiet Tuesday. Activation codes that mean nothing vs everything. That judgement isn't in the code — it needs to get into the rules. |
| **A week of real use beats any demo** | Between sessions you work real cases in it. Everything wrong, noisy or missing gets logged and triaged the next morning. |

---

## Schedule

| | Session | Focus | Ends with |
|---|---|---|---|
| **Day 1** | 1 · Is the data true? | Lineage, freshness, every definition on the dashboard, attribution, coverage | 12 definitions signed off |
| *Day 1→2* | *stand-up* | Triage what you logged | fixes started same day |
| **Day 2** | 2 · Are the alerts right? | Rule mechanics, all 43 rules, baselines, INC0016809, correlation & escalation | every threshold has a verdict |
| *Day 2→3* | *stand-up* | Triage | |
| **Day 3** | 3 · Is it useful? | Troubleshoot board, timeline, three real incidents replayed, ownership | verdict + ranked backlog |
| **Day 4–5** | live use | You run it on real traffic | Friday: ranked list of what's wrong |

Fill in actual dates and times before sharing. Each session includes a break at the halfway point.

---

## Session 1 — Is the data true?

| # | Module |
|---|---|
| 1.1 | Architecture & data lineage — where every number comes from |
| 1.2 | Sync, lag, and how you know the data is stale |
| 1.3 | **Definitions review — the order flow, one box at a time** |
| 1.4 | Attribution: the trap that made an unlaunched channel look live |
| 1.5 | Coverage — what the console can and cannot see |
| — | Review block: sign off 12 definitions |

**1.3 is the centre of the whole week.** Every box on the order-flow tree is a definition you can
veto. Some already have open questions:

- Pending → **stuck** currently needs a gateway commit response present. Is 3h the right cut-off?
- **Not Assigned** now excludes partner-fulfilled orders (tygo/soob ship their own SIMs). Is the
  partner list complete?
- **Delivered** uses a fixed list of delivery states. Is that list current?
- **Activated** trusts `onboarding_orders.activated`. Does BSS agree?

**Homework:** take five real cases you handled that day. Find each in the console. Log every place
it disagreed with what you knew, or couldn't answer the question at all.

---

## Session 2 — Are the alerts right?

| # | Module |
|---|---|
| 2.1 | How a rule actually evaluates — window, min_sample, dimension |
| 2.2 | The 43 rules by severity — what pages you at 3am |
| 2.3 | Baselines vs absolutes — the 55% problem |
| 2.4 | **INC0016809 — how a P1 ran an hour with a green console** |
| 2.5 | Correlation, escalation, SLA & error budget |
| — | Review block: sign off every threshold |

Current state: **43 rules · 33 metrics · 15 P1 · 24 P2 · 4 P3**, and five rules disabled
(`dealer_activity_drop`, `hyperpay_hard_down`, `ownership_fail_spike`, `payment_zatca_gap`,
`tap_hard_down`) — we decide together whether they stay off. Note `tap_hard_down` + Tap
reconciliation both being off means a total Tap outage is currently invisible — first item on
the session-2 agenda.

Every rule gets one of four verdicts:

| Verdict | What happens |
|---|---|
| **KEEP** | it's now yours |
| **CHANGE** | changed live in the session, with the metric chart open |
| **DELETE** | disabled — better than a muted rule pretending to be coverage |
| **MISSING** | new rule drafted before session 3 |

**The four new BSS rules need your judgement most.** I set those thresholds from a single incident;
you've seen hundreds.

**Homework:** for every alert that fires before we next meet, mark it **actionable** or **noise**.
That one column is how we tune for the next six months.

---

## Session 3 — Is it useful?

| # | Module |
|---|---|
| 3.1 | Troubleshoot board — from symptom to cause |
| 3.2 | Timeline & Subscriber 360 — one customer end to end |
| 3.3 | Replay: INC0016809 (BSS 1500) |
| 3.4 | Replay: UPG down, masked by failover |
| 3.5 | Replay: Semati flapping — alert or ignore? |
| — | Verdict, ranked backlog, who owns what |

You drive. Simulate replay against the real incident window, no hindsight. The test for each:
**would this have saved you time on the actual bridge call — and if not, what exactly was missing?**

A polite "yes it's useful" is worth nothing. The useful answer is the specific click that wasn't
there, the number you had to go elsewhere for.

---

## Between sessions — the loop

**You, during the day:** use it on a real case → something looks off → log it → keep working.

**Us, next morning:** triage → classify → fix or schedule → you see the fix.

| Finding type | Example | Who fixes | Target |
|---|---|---|---|
| **Data wrong** | a KPI disagrees with BSS/prod | console owner | **same day** — worst kind |
| **Alert noisy** | fires nightly, never actionable | L2 + owner together | next session |
| **Alert missing** | an incident nothing caught | console owner | next session |
| **Hard to use** | six clicks to answer one question | console owner | backlog, ranked in S3 |

Log everything in `L2-Review-Log.xlsx`. Ask in the channel, not in a DM — the channel is the record.

---

## What I need from you

**Be specific, not polite.** "The payment page is confusing" can't be fixed. "Decline reason isn't
visible without two clicks" was fixed the same day.

**Report numbers that look wrong first.** Every serious defect so far was found by someone saying
"that looks wrong" — the reseller figures, the staleness banner, the stuck payments. All of them.

**Say when an alert wasted your time.** Noise isn't a minor complaint; it's how a monitoring system
dies. A rule you've learned to ignore is worse than one that doesn't exist.

> **By Friday I want a ranked list of what's wrong — not a list of what's good.**

---

## After this week

| Area | Owner | Cadence |
|---|---|---|
| Daily health — data fresh and sane? | L2 on duty | each morning |
| Alert tuning — thresholds, noise, gaps | L2 lead + console owner | weekly, charts open |
| New detections after an incident | whoever ran the incident | written up within 48h |
| Definitions — what a KPI counts | L2 agree, owner implements | on change |
| Training L1 | L2, once this review closes | next series |

**Green light for L1 is a decision we make in session 3, not an assumption.**

---

## Before session 1

**Facilitator:**

```bash
ssh yosri@172.31.38.152 && sudo su -
cd /apps/console/server && set -a; . ../.env; set +a
node /apps/console/server/postdeploy-check.cjs    # 22 checks — all green before you present
```

- Accounts created for every attendee at **L2 Digital** role (`05-USER-SETUP-RUNBOOK.md`)
- Pick today's live examples for 1.3 — a scenario dies if the example returns "not found"
- Teams links filled into `workshop.config.json`

**Attendees:** bring a real case from this week that was harder than it should have been.

---

## Materials

| File | Use |
|---|---|
| `Salam-Console-L2-Review.pptx` | The deck — 26 slides, review blocks built in |
| `L2-REVIEW-PLAN.md` | This file — share it today |
| `L2-Review-Log.xlsx` | Findings log + threshold sign-off sheet |
| `03-SCENARIOS.md` | Incident replays for session 3 |
| `05-USER-SETUP-RUNBOOK.md` | Account creation |
| `docs/INC0016809-detection-gap.md` | The case study behind session 2.4 |
