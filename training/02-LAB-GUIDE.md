# Lab Guide — every hands-on exercise, step by step
Give each attendee this document. Each lab states: **goal · steps · expected result · if it goes wrong**.

Console: **https://salam.sa/digital-console/**

---

# DAY 1

## LAB 1.1 — Sign in (20 min, everyone)
**Goal:** everyone is in, at the right role, and understands what they're looking at.

Steps and troubleshooting are in `05-USER-SETUP-RUNBOOK.md` §2. Do not skip §3 (verification).

**Expected result:** your name and role label appear top-right. You can state your role aloud.

---

## LAB 1.2 — Explore your own permissions (15 min)
**Goal:** understand least privilege by testing your own boundaries.

1. Look at the **top navigation**. Write down which tabs you can see.
2. Compare with the person next to you — **do you see the same tabs?** Why not?
3. Open **Troubleshoot** (if you have it). Find any row with a mobile number. **Is it masked?**
4. Try to open **⚙ Settings**. Can you?
5. Find one thing you *cannot* do that a colleague can.

**Expected result** — you can complete this sentence:
> *"I am a ______. I can see ______. I cannot ______. Customer numbers appear ______ to me."*

**Facilitator:** put an L1 and the L3 side by side on the projector for step 3. Then open
**⚙ → Audit log** and show the unmask entry appearing in real time.

---

## LAB 1.3 — Read today's health (20 min)
**Goal:** interpret the dashboard correctly, including its warnings.

1. Open **Dashboard**. Set the range to **Today**.
2. Write down: orders · payments OK · payment success % · errors.
3. Switch to **7d**, then **30d**. Which numbers move most? Why?
4. Look at the **journey-health strip** — is any journey amber or red?
5. Look for a **staleness banner**. Is there one? What would it mean if there were?
6. Find the **Order status flow** section. Follow one lane from orders → activation.
7. In the flow tree, find the stage with the **biggest drop-off**. Say what that stage means.

**Expected result:** you can answer *"is today normal?"* with evidence, and you know to check the
staleness banner before quoting any figure.

**If numbers look wrong:** check the range (Today at 09:00 is a small window), and check the banner.
Don't assume the console is broken — assume the window is small.

---

# DAY 2

## LAB 2.1 — Find the customer (25 min) → **Scenario A**
**Goal:** turn a customer complaint into a factual answer.

1. Open **Troubleshoot**.
2. Search the number the facilitator gives you.
3. Answer the four questions from Scenario A.
4. Expand the row → read the **timeline**.
5. Write your customer response in one sentence, using the cheat-sheet wording.

**Expected result:** a verdict (failed / stuck / abandoned) plus the wording you'd actually say.

**If "not found":** the customer may have no failures (good news — say so), or the number format
differs. Try the last 9 digits. Ask the facilitator for a known-live example.

---

## LAB 2.2 — Payment forensics (30 min) → **Scenarios B + C**
**Goal:** distinguish the three payment problems and understand per-gateway blindness.

**Part 1 — the tiles (10 min)**
1. Troubleshoot → click **Payment / gateway**. Note the count.
2. Click **Payment stuck (unconfirmed)**. How is this different from the first tile?
3. Click **Payment duplicate (suspected)**. Why "suspected"?

**Part 2 — decline codes (10 min)**
4. On the Payment tile, find the **code · message breakdown**.
5. Which decline reason is most common right now?
6. Click that chip — the feed filters. Look at 3 rows. Same story?
7. Match it to the cheat-sheet wording.

**Part 3 — gateways (10 min)**
8. Use the **gateway chips** (UPG · HyperPay · Tap · Samsung Pay).
9. Compare failure counts per gateway. Is one worse?
10. Alerts → find the **UPG gateway zero-success watchdog**. Read its runbook.

**Expected result:** you can explain why a healthy blended number can hide a dead gateway.

---

## LAB 2.3 — Run an incident (25 min) → **Scenario D**
**Goal:** practise the response, not just the observation.

Follow the 9 steps in Scenario D with assigned roles. Everyone observes the handover; the group
critiques it afterwards against these criteria:

- [ ] Acknowledged promptly
- [ ] Runbook actually read (not skipped)
- [ ] Handover named the rule + the numbers + what was checked
- [ ] Blast radius quoted, not guessed
- [ ] Correlation checked (root vs symptom)
- [ ] Decision recorded as a comment

---

# DAY 3

## LAB 3.1 — Build a panel (30 min)
**Goal:** answer your own question without asking anyone for a report.

1. **Analytics** → browse the category chips. Open two preset dashboards.
2. Pick a real question you actually want answered. Examples:
   - "Payment success by gateway, hourly, last 7 days"
   - "Activation failures by status code, last 24h"
   - "Orders by flow type, last 30 days"
3. Click **+ Panel**.
4. Choose: **dataset** → **metric** → **visualisation** → **time bucket** → **group by**.
5. Add a filter (e.g. platform, vendor, status).
6. Preview. Adjust until it answers the question.
7. **Save** it to a dashboard.
8. Show the room your panel and what it told you.

**Expected result:** a saved panel that answers a question you actually had.

**Common mistakes:** grouping by something with hundreds of values (unreadable); picking a window so
short there's no data; using a rate viz where you wanted a count.

---

## LAB 3.2 — Answer three commercial questions (20 min)
**Goal:** use Growth data correctly — including knowing what *not* to trust.

Using **Growth**:
1. Which sales path produces the most **activated** lines — and what's its conversion?
2. Which campaign source converts best? (Careful: best *volume* ≠ best *conversion*.)
3. Which donor operator sends us the most port-ins, and which has the **worst activation rate**?
   What would you do about that?

Then the honesty question:
4. The reseller channel numbers were once badly wrong — a channel that wasn't even launched showed
   311 orders. **What caused it, and how do you know today's number is right?**

**Expected result:** three answers with numbers, plus an explanation of attribution
(`external_service_name` = the order's real origin; `plan_channels` = mere configuration).

---

## LAB 3.3 — Tune a rule (20 min) → **Scenario E**
**Goal:** change alerting safely.

1. Alerts → **Metric charts** → find the metric for the nominated rule.
2. Study the **seasonal band**. What is normal for this hour of the week?
3. Alerts → **Alert rules** → open the rule.
4. Change **one** thing (threshold / window / min-sample / active hours). Only one.
5. **Test now** — confirm it doesn't fire against healthy live data.
6. Save with a comment: what you changed and why.
7. Tell the room what the rule will still catch.

**Expected result:** a safer rule that you can justify — and no loss of coverage.

**Rule of thumb:** if you can't say what the rule would still catch after your change, you've broken it.

---

## LAB 3.4 — Ask Yusr (10 min)
**Goal:** know when the assistant helps and when to verify it.

1. Click the green bubble (bottom-right).
2. Ask about a subscriber: *"what happened to 05xxxxxxxx?"* (use a test number).
3. Ask about incidents: *"what's open right now?"*
4. Ask a how-to: *"how do I check if a payment was captured?"*
5. **Verify one of its answers against the console yourself.**

**Expected result:** you can describe what Yusr is good at (fast summaries, pointing you to the right
screen) and the rule: **verify before you act on it with a customer.**

---

# Post-workshop: your first week

| Day | Do this |
|---|---|
| 1 | Open the dashboard each morning. Note anything amber/red. |
| 2 | Handle one real customer case entirely through Troubleshoot. |
| 3 | Acknowledge one real incident and read its runbook. |
| 4 | Build one panel that answers a question you get asked often. |
| 5 | Report one thing that's wrong, confusing or missing — this is how the tool improves. |

**Where to get help:** Yusr (in-console) → the L1 cheat-sheet → your L2 → the console owner.
