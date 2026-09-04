# Salam Digital Console — 3-Day Technical Workshop
**Format:** 3 sessions × 2.5–3 hours · small technical group (5–8) · hands-on, everyone on a laptop
**Outcome:** every attendee has a working account at the right role and can run their part of the ops workflow unaided.

---

## Before you read further — the one rule of this workshop

> **Nobody watches. Everybody clicks.**
> Every module is *show 10 minutes → they do it 15 minutes → 5 minutes debrief*. If an attendee has not
> touched the console in the last 20 minutes, the session has drifted.

---

## Cohort & roles

Fill this in before Day 1 — it drives the account-creation lab (Lab 1.2).

| # | Name | Work email (@salam.sa) | Job today | Console role to assign | Team |
|---|------|------------------------|-----------|------------------------|------|
| 1 | *(you)* | y.yahmed.sns@salam.sa | Owner | `Super Admin` | Digital Ops |
| 2 | | | L1 call-centre / NOC | `L1 Digital` | Digital Ops |
| 3 | | | L1 BSS | `L1 BSS` | BSS Ops |
| 4 | | | L2 escalation | `L2 Digital` | Digital Ops |
| 5 | | | L2 BSS | `L2 BSS` | BSS Ops |
| 6 | | | Ops lead / reporting | `Report Manager` | Sales Ops |
| 7 | | | Deep technical | `L3 Digital` | Digital Ops |
| 8 | | | Manager (view only) | `Report Manager` | Sales Ops |

**Role reference (from `server/src/roles.js` — exact, not approximate):**

| Role | Rank | Views | Capabilities |
|---|---|---|---|
| Super Admin | 1 | all 8 | edit rules · manage sync · manage users · **unmask PII** · export · ack |
| Admin | 2 | all except User management | edit rules · manage sync · export · ack |
| L3 Digital | 3 | all except User management | edit rules · manage sync · **unmask PII** · export · ack |
| Report Manager | 3 | Topology · Journeys · Integrations · Analytics/SLA · Alerts | export |
| Errors Manager | 3 | Topology · Journeys · Troubleshoot · Alerts | edit rules · export · ack |
| Events Manager | 3 | Topology · Journeys · Integrations · Alerts | edit rules · manage sync |
| L2 Digital / L2 BSS | 4 | Topology · Journeys · Integrations · Alerts · Troubleshoot · Analytics | edit rules · export · ack |
| L1 Digital / L1 BSS | 5 | Topology · Journeys · Integrations · Alerts · Troubleshoot · Analytics | export · ack |

Two facts to state out loud on Day 1, because they surprise people:
- **Only Super Admin and L3 Digital can unmask PII.** Everyone else sees masked customer data, always.
- **Multi-role users get the union of views and the OR of capabilities**, and are labelled by their highest-ranked role.

---

## Pre-flight checklist — do this the day before (30 min)

Run on 152. Every item must pass or the workshop stalls.

```bash
ssh yosri@172.31.38.152 && sudo su -
cd /apps/console/server && set -a; . ../.env; set +a

# 1. app up and serving
curl -s -o /dev/null -w "console: %{http_code}\n" http://localhost:4600/

# 2. data is fresh (this is what makes demos real)
node sync-watchdog.cjs ; echo "watchdog exit=$?"

# 3. full health report — indexes, timings, cache
node healthcheck.cjs | tail -25

# 4. today's numbers are non-zero (dead data = dead workshop)
curl -s "localhost:4600/api/home?hours=6" -H "X-Console-User: y.yahmed.sns@salam.sa" | head -c 200
```

| Check | Pass criteria | If it fails |
|---|---|---|
| Console HTTP | `200` | `pm2 restart salam-console`, check `pm2 logs` |
| Watchdog | `exit=0`, lag < 10m | run it again; if lag stays high see §2d of healthcheck |
| Indexes | all `OK` in section 1 | run the `CREATE INDEX CONCURRENTLY` lines it prints |
| Live data | non-zero orders/payments | if zero, check the range and the staleness banner |
| **Email/OTP** | OTP mail arrives | **if SMTP is still blocked** → use the log-code workaround (below) |

### ⚠ If SMTP is not fixed by Day 1 — the login workaround
The OTP code is generated and logged even when the email fails. As Super Admin you can read it:

```bash
grep "sign-in code" /apps/console/logs/console.out.log | tail -5
```

Tell attendees up front: *"I'll read your code out — email delivery is pending an infra ticket."*
Plan **10 extra minutes** on Day 1 for this. It is also a genuine teaching moment about the
staleness/notification design.

### Room setup
- Projector on the facilitator's screen; attendees on their own laptops on VPN.
- URL on the whiteboard: **https://salam.sa/digital-console/**
- Have the **Troubleshoot** page open in a spare tab for live examples.
- Print one **L1 cheat-sheet** (Appendix A of `03-SCENARIOS.md`) per attendee.

---

## Curriculum at a glance

| Day | Theme | Who it's aimed at | Outcome |
|---|---|---|---|
| **1** | Foundations, access & the daily loop | Everyone | Every attendee logged in, at the right role, and able to read the dashboard |
| **2** | Troubleshooting & incident response | L1 + L2 primarily | Can take a customer complaint → root cause → action, and run an incident |
| **3** | Analytics, tuning & platform depth | L2 + L3 + Ops leads | Can build a dashboard, tune a rule, and explain the data pipeline |

---

# DAY 1 — Foundations, Access & the Daily Loop
**Duration 2h 45m** · Everyone attends

| Time | Module | Format |
|---|---|---|
| 0:00 | **M1.1** Why this exists — the four blind spots | Talk + discussion |
| 0:20 | **M1.2** Architecture in one picture | Talk |
| 0:35 | **LAB 1.1** Everyone signs in | Hands-on |
| 0:55 | **LAB 1.2** Roles & access — create/verify each account | Hands-on (facilitator-led) |
| 1:20 | ☕ Break (10m) | |
| 1:30 | **M1.3** The Dashboard, field by field | Demo + hands-on |
| 2:00 | **LAB 1.3** Read today's health | Hands-on |
| 2:20 | **M1.4** PII, audit and the rules of engagement | Talk |
| 2:35 | **QUIZ 1** (10 questions) + debrief | Quiz |
| 2:45 | Close: homework | |

### Learning objectives
By the end of Day 1 an attendee can:
1. Explain what the console reads (a **replica**, never prod) and why that matters.
2. Sign in, and describe what their own role can and cannot do.
3. Read the dashboard KPI strip, journey-health tiles and NOC banner correctly.
4. Recognise the **staleness banner** and know that stale data outranks every other status.
5. State the PII rule and know that unmasking is audited.

### M1.1 — Why this exists (20m)
Open with the real incidents, not the feature list. Ask the room first:
> *"Tell me the last time a customer problem took more than an hour to explain. What did you have to check?"*

Then walk the four blind spots (details in the deck, slides 4–9):
- **UPG hid behind failover** (INC0014859) — the blended rate stayed green.
- **Charged but not activated** — `pending` was excluded from the failure denominator, so it counted as neither.
- **Duplicate charge** — one order, two captures; only visible by reconciling with the gateway.
- **Semati flapping** — ~55% baseline failure means a flat threshold is useless.

**Facilitator note:** this is the emotional buy-in for the whole 3 days. Do not rush it.

### M1.2 — Architecture (15m)
Draw this on the whiteboard, live:

```
   prod (172.31.43.123)          ← the real thing, we NEVER write here
        │  read-only, incremental, every 5 min (prod-sync + cron watchdog)
        ▼
   salam_replica (172.31.15.121) ← everything you see is queried from here
        │
   mvno_console (172.31.15.121)  ← the console's own brain: rules, alerts, users, audit
        │
   Console app (172.31.38.152:4600, PM2)  →  nginx on 115  →  salam.sa/digital-console/
```

Three points to land:
1. **Read-only by construction** — the prod connection is forced `default_transaction_read_only=on`.
2. **~5 minute freshness** is normal and expected; the watchdog enforces it.
3. If the pipeline stalls, the console **says so loudly** rather than showing stale numbers silently.

### LAB 1.1 / LAB 1.2 → see `02-LAB-GUIDE.md`
### QUIZ 1 → see `04-QUIZZES.md`

### Homework (5 min to explain)
> "Before tomorrow, open the console once from your phone and find: today's payment success rate,
> and one failed order in Troubleshoot. Bring one real customer case you couldn't explain."

---

# DAY 2 — Troubleshooting & Incident Response
**Duration 3h** · L1 + L2 core; others welcome

| Time | Module | Format |
|---|---|---|
| 0:00 | Recap + homework cases (use their real cases!) | Discussion |
| 0:15 | **M2.1** Troubleshoot: the Error Control Board | Demo |
| 0:35 | **LAB 2.1** Find the customer *(scenario A)* | Hands-on |
| 1:00 | **M2.2** Reading a timeline & the code drill-downs | Demo |
| 1:15 | **LAB 2.2** Payment forensics *(scenarios B, C)* | Hands-on |
| 1:45 | ☕ Break (10m) | |
| 1:55 | **M2.3** Alerts: rules, severity, correlation | Demo |
| 2:15 | **LAB 2.3** Run an incident end to end *(scenario D)* | Role-play |
| 2:40 | **M2.4** Escalation ladder & what to tell the customer | Talk + cheat-sheet |
| 2:50 | **QUIZ 2** (12 questions) + debrief | Quiz |
| 3:00 | Close | |

### Learning objectives
1. Search a customer by MSISDN / order / ICCID / national ID and read the result.
2. Distinguish **payment failed** vs **payment stuck** vs **duplicate** — and what each means for the customer.
3. Use the code·message drill-downs to name the actual failure cause.
4. Acknowledge, assign and resolve an incident, and know when to escalate.
5. Use the right customer-facing wording for the top 7 payment declines.

### M2.3 key teaching point — the golden rule
> **"An alert fires on *change from normal*, not on the normal baseline."**
> The steady state lives on the **SLA** page. The **Alerts** page is for things that just got worse.
> Semati failing 55% today is *normal*. Semati failing 80% for an hour is an *incident*.

---

# DAY 3 — Analytics, Tuning & Platform Depth
**Duration 2h 45m** · L2 + L3 + Ops leads (L1 optional for the first hour)

| Time | Module | Format |
|---|---|---|
| 0:00 | Recap + open questions | Discussion |
| 0:10 | **M3.1** Analytics: 14 dashboards, then build your own | Demo |
| 0:30 | **LAB 3.1** Build a panel that answers a real question | Hands-on |
| 1:00 | **M3.2** Growth, resellers, campaigns, MNP donors | Demo |
| 1:15 | **LAB 3.2** Answer 3 commercial questions with data | Hands-on |
| 1:35 | ☕ Break (10m) | |
| 1:45 | **M3.3** SLA, error budget & anomaly detection | Demo |
| 2:00 | **M3.4** Tuning a rule without crying wolf | Demo + hands-on |
| 2:20 | **LAB 3.3** Tune a threshold against live data *(scenario E)* | Hands-on |
| 2:35 | **M3.5** Yusr, integrations & the platform underneath | Demo |
| 2:50 | **QUIZ 3** (12 questions) + certification + close | Quiz |

### Learning objectives
1. Build and save an Analytics panel from scratch.
2. Interpret reseller/campaign attribution correctly — and know why `plan_channels` is the wrong source.
3. Read an SLO with its error budget; explain what "at risk" means.
4. Change a rule threshold safely, using **Test now** before saving.
5. Explain, at a high level, prod-sync, the watchdog, caching, and why timestamps are UTC.

### M3.4 — the tuning discipline (teach this explicitly)
1. Look at the **metric chart** first — what *is* normal? Note the seasonal band.
2. Set the threshold **above the noise**, not above zero.
3. Set `min_sample` so a quiet hour can't trigger it.
4. Hit **Test now** — does it fire against live data right now? It shouldn't, unless something is genuinely wrong.
5. Save, then **watch it for 24h** before trusting it.
6. If it cried wolf: raise the threshold or the sample gate — don't disable the rule.

---

## Assessment & certification

| Instrument | When | Pass mark |
|---|---|---|
| Quiz 1 (10 Q) | End of Day 1 | 7/10 |
| Quiz 2 (12 Q) | End of Day 2 | 9/12 |
| Quiz 3 (12 Q) | End of Day 3 | 9/12 |
| **Practical sign-off** | During Day 2–3 labs | facilitator observes each attendee complete Scenario A and D unaided |

Certification = all three quizzes passed **and** practical sign-off. Anyone short gets a 30-minute
follow-up rather than a re-run of the whole day.

---

## Materials index

| File | What it is |
|---|---|
| `00-TRAINING-PLAN.md` | This document — curriculum, timings, objectives |
| `01-FACILITATOR-GUIDE.md` | What to say, common questions, what to do when things break |
| `02-LAB-GUIDE.md` | Every lab, step by step, with expected results |
| `03-SCENARIOS.md` | Five realistic scenarios + the L1 cheat-sheet (Appendix A) |
| `04-QUIZZES.md` | All three quizzes with answer keys and explanations |
| `05-USER-SETUP-RUNBOOK.md` | The Day-1 account creation lab, done properly |
| `Salam-Console-Training.pptx` | The deck (light technical style) |
| `build_training_deck.py` | Rebuild the deck; drop screenshots into `shots/` |
