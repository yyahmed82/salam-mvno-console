# Workshop Scenarios
Five realistic scenarios built from **real incidents this console was designed around**.
Each one: the situation → what the attendee must do → what "correct" looks like → the teaching point.

> **Facilitator:** run these against **live data**. Before each session, do the 2-minute prep in
> `01-FACILITATOR-GUIDE.md` §"Finding today's examples" so you hand out MSISDNs/orders that actually
> exist today. Scenarios degrade badly if the example returns "not found".

---

## Scenario A — "The customer says they paid but nothing happened"
**Day 2 · Lab 2.1 · 25 min · L1 primary**

### The situation (read aloud)
> A customer calls the centre. *"I paid yesterday for a new line. The money left my account. The app
> still says my order isn't paid, and no SIM has arrived."* They give you their mobile number.

### The task
1. Open **Troubleshoot**.
2. Search the number (facilitator gives a live one).
3. Answer these four questions **out loud** before touching anything else:
   - Did a payment attempt exist at all?
   - What is its **status** — success, failed, pending?
   - If failed: what is the **decline code and message**?
   - Where did the order stop — payment, activation, or delivery?
4. Open the row's **timeline** and read the story end to end.
5. Decide: what do you tell this customer, and who (if anyone) do you escalate to?

### What correct looks like
The attendee lands on one of three verdicts, and can justify it:

| Finding | Verdict | Customer wording |
|---|---|---|
| Payment `fail` with a decline code | The bank/gateway refused it | Use the cheat-sheet line for that code — *"the payment was declined by your bank; please try again or use another card"* |
| Payment `pending` **with** a commit response (>30m) | **Stuck** — money may be captured, app never confirmed | *"We can see your payment; it hasn't been confirmed to our system. We're reconciling it now."* → escalate to L2 with the `payment_reference_id` |
| Payment `pending`, **no** commit response | Abandoned — customer never completed the page | *"We don't have a completed payment. Let's try again together."* — **not** an incident |

### Teaching point ⭐
> **"Stuck" and "abandoned" look identical in a naive dashboard — and they're opposite problems.**
> The console distinguishes them by whether the gateway ever came back (a *commit response*). One means
> the customer is owed money and an escalation. The other means they simply didn't finish. Getting this
> wrong either refunds people who never paid, or leaves charged customers stranded.

### Facilitator prompts
- *"How would you have answered this yesterday, without the console?"* (expect: 3 teams, 40 minutes)
- *"What's the one field you'd paste into the escalation?"* (answer: `payment_reference_id`)

---

## Scenario B — "Two charges on one order"
**Day 2 · Lab 2.2 · 15 min · L1 + L2**

### The situation
> *"I was charged twice for the same order. I want one refunded."* Reference: the customer gives you
> their number and the amount.

### The task
1. Troubleshoot → the **Payment duplicate (suspected)** tile.
2. Find the customer's group. Read what it's telling you: same customer + same amount + same target,
   charged 2+ times inside 30 minutes.
3. Note the **payment reference ids** — plural.
4. State what you *cannot* conclude from this screen alone, and what would confirm it.

### What correct looks like
The attendee says something like:
> *"The console flags this as **suspected** — it sees two successful payments that match. To confirm
> a real double capture I need Tap/UPG reconciliation, because the gateway is the authority on whether
> money actually moved twice. Then a refund for the extra capture."*

### Teaching point ⭐
> **The console is deliberately honest about its own limits.** It says *suspected*, not *confirmed*,
> because the app database can't see the gateway's second capture. The Tap reconciliation path exists
> exactly for this. Never promise a customer a refund from the suspicion screen alone.

---

## Scenario C — "A gateway is down but everything looks green"
**Day 2 · Lab 2.2 · 15 min · L2 primary**

### The situation
> It's 09:30. Nobody has called. The payment success rate on the dashboard reads a healthy 84%.
> A colleague says "I think card payments are failing for some people."

### The task
1. Dashboard → check the blended payment KPI. It looks fine. **Why is that not enough?**
2. Troubleshoot → Payment → use the **gateway filter chips** (UPG · HyperPay · Tap · Samsung Pay).
3. Compare the gateways against each other.
4. Alerts → find the **UPG gateway zero-success watchdog** rule and read its runbook.

### What correct looks like
The attendee explains the failover trap in their own words:
> *"If UPG dies and traffic fails over to HyperPay, the blended number stays green — the successes are
> just coming from a different gateway. You have to look **per gateway**. That's why there's a
> zero-success watchdog per gateway rather than one payment-failure rule."*

### Teaching point ⭐
> This is **INC0014859**, verbatim. Real cost: a 34-minute blind spot before anyone noticed, and the
> only reason it was noticed at all was a customer complaint. **Averages hide outages. Always ask
> "averaged over what?"**

---

## Scenario D — "P1 incident, you're on call"
**Day 2 · Lab 2.3 · 25 min · role-play, everyone participates**

### Setup
Facilitator picks a **real open or historical incident** (Alerts → History if nothing is open) and
assigns roles around the table: one L1 (first responder), one L2 (escalation), one "manager" (asks
the awkward questions), rest observe then critique.

### The task — run it properly
| Step | Who | What they must do |
|---|---|---|
| 1 | L1 | Open the incident. Read the **headline** and **severity** aloud. |
| 2 | L1 | Read the **runbook steps** attached to the rule. Do step 1. |
| 3 | L1 | **Acknowledge** — and explain why that matters (stops the ladder). |
| 4 | L1 | State the **blast radius**: what else is affected? |
| 5 | L1 → L2 | Escalate with a one-paragraph handover: what, since when, what's been checked. |
| 6 | L2 | Check **correlation** — is this the root cause or a symptom of something bigger? |
| 7 | L2 | Check **related ServiceNow tickets** — are customers already reporting it? |
| 8 | Manager | Ask: *"Is this affecting customers right now, and how many?"* — team must answer with data. |
| 9 | L2 | Decide: resolve, or keep open with a comment stating what we're waiting on. |

### What correct looks like
- Acknowledged within the first minute of opening it.
- The handover names the **rule**, the **metric value vs threshold**, and **what was already checked** — not "payments are broken".
- Blast radius quoted from the incident, not guessed.
- Someone notices whether the root-cause alert is suppressing symptom alerts.

### Teaching point ⭐
> **The runbook travels with the alert.** Nobody should be searching a wiki at 3am. If a runbook step
> is wrong or missing, that's a bug in the rule — fix the rule, don't work around it. Show them how to
> edit the runbook text (L2+ can).

---

## Scenario E — "This alert cries wolf"
**Day 3 · Lab 3.3 · 20 min · L2 + L3**

### The situation
> An alert has fired eleven times this week and every time it was nothing. The team has started
> ignoring it. *(This is the most dangerous state an alerting system can be in.)*

### The task
1. Alerts → **Alert rules** → pick the rule (facilitator nominates one, e.g. a payment or delivery rule).
2. Open **Metric charts** for its metric. Study the **seasonal band** — what IS normal for this hour of the week?
3. Decide what to change, and justify it:
   - threshold too close to the baseline?
   - window too short (spiky)?
   - `min_sample` too low (fires on 3 events at 04:00)?
   - should it be time-restricted (business hours only)?
4. Change it. Hit **Test now** — it must NOT fire against current healthy data.
5. Save. Write a comment saying what you changed and why.

### What correct looks like
The attendee raises the **sample gate** or the **threshold** — and can say what the rule would still catch:
> *"I raised min_sample from 5 to 30 so a quiet hour can't trigger it, and left the threshold at 40%.
> It'll still catch a genuine storm, because a storm has volume by definition."*

### Teaching point ⭐
> **Never fix a noisy alert by deleting it.** A deleted rule is a blind spot with no record. Raise the
> bar until it only fires on things you'd want to be woken for — then trust it. And the discipline:
> *look at the chart first, change second.* Guessing thresholds is how you get here in the first place.

---

# Appendix A · L1 Cheat-Sheet
*(print one per attendee — this is the single most-used artefact after the workshop)*

### Search anything
Troubleshoot → search box accepts: **mobile number · order id · ICCID · national ID**

### What the payment statuses actually mean
| Status | Meaning | Action |
|---|---|---|
| `success` | Money taken, order proceeds | none |
| `fail` | Gateway/bank declined | read the decline code → use the wording below |
| `pending` **+ commit response**, >30 min | **Stuck** — may be charged, unconfirmed | escalate L2 with `payment_reference_id` |
| `pending`, no commit response | Customer abandoned the page | not an incident — help them retry |
| `refunded` | Already refunded | none |

### Top decline codes → what to tell the customer
| What you see | Say this |
|---|---|
| Insufficient funds | "The bank declined it for insufficient funds — please check the balance or try another card." |
| Invalid CVV / expired card | "The card details weren't accepted — please re-check the CVV and expiry." |
| 3DS / OTP not completed | "The bank's verification step wasn't completed — please retry and approve the SMS/app prompt." |
| Do not honor | "The bank declined without a reason — this is on the bank's side; please contact them or use another card." |
| Charged but app says unpaid | "We can see the payment; it hasn't been confirmed to our system yet. We're reconciling it — you don't need to pay again." **→ escalate** |
| Duplicate charge | "I can see two matching charges. I'm raising this for verification and refund of the extra one." **→ escalate** |
| Samsung Pay failing | "That method is having trouble — please try a card or mada while we investigate." |

### BSS / Semati status codes
`00` ok · `600` ok · **`715`** provider unavailable (CITC/TCC — not our fault, check the Semati alerts)
· `726` mobile already exists · `727` number not found (MNP — verify with current provider)
· `738/740` ID expired/invalid — customer must visit civil affairs · `812/823` service errors

### Nafath
`expired` — the customer didn't approve in time, ask them to retry ·
`rejected` — they declined in the Nafath app · `400-N069` / `400-N999` — provider errors, retry then escalate

### The one thing to check before believing any number
Look at the top of the dashboard. If there's a **red/amber staleness banner**, the figures are **not
live** — say so before quoting anything to a customer or a manager.

### When to escalate (don't hesitate)
- Money taken but not confirmed → **L2 now**
- Duplicate charge → **L2 now**
- The same failure across many customers in a short time → **L2 now** (it's an incident, not a case)
- Anything where you'd have to guess what to tell the customer
