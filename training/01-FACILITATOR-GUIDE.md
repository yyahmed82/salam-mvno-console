# Facilitator Guide
Everything you need to run the three sessions — including what to do when the demo betrays you.

---

## The 2-minute prep before every session — "finding today's examples"
**Do this every single time.** A scenario with a dead example kills the room's confidence.

```bash
ssh yosri@172.31.38.152 && sudo su -
cd /apps/console/server && set -a; . ../.env; set +a

# 1. Is data fresh? (must be < 10 min)
node sync-watchdog.cjs

# 2. Grab live examples for today's labs — masked-safe: use these as SEARCH INPUTS only
node -e '
const {Client}=require("pg"); process.env.TZ="UTC";
const c=new Client({connectionString:process.env.SOURCE_DATABASE_URL,options:"-c timezone=UTC"});
c.connect().then(async()=>{
  const q=async(t,s)=>{const r=await c.query(s);console.log("\n=== "+t+" ===");r.rows.forEach(x=>console.log(JSON.stringify(x)));};
  await q("FAILED PAYMENTS (Scenario A)", `SELECT customer_mobile_number AS mobile, fail_reason, created_at
     FROM payments WHERE status IN ('"'"'fail'"'"','"'"'failed'"'"') AND created_at > now()-interval '"'"'24 hours'"'"'
     ORDER BY created_at DESC LIMIT 5`);
  await q("STUCK PAYMENTS (Scenario A/B)", `SELECT customer_mobile_number AS mobile, payment_reference_id, vendor, amount
     FROM payments WHERE lower(status) IN ('"'"'pending'"'"','"'"'initiated'"'"')
       AND payment_commit_response IS NOT NULL AND payment_commit_response::text NOT IN ('"'"''"'"','"'"'{}'"'"','"'"'null'"'"')
       AND created_at > now()-interval '"'"'48 hours'"'"' ORDER BY created_at DESC LIMIT 5`);
  await q("GATEWAY MIX (Scenario C)", `SELECT vendor, count(*) FILTER (WHERE status='"'"'success'"'"') ok,
     count(*) FILTER (WHERE status IN ('"'"'fail'"'"','"'"'failed'"'"')) fail
     FROM payments WHERE created_at > now()-interval '"'"'6 hours'"'"' GROUP BY 1 ORDER BY 2 DESC`);
  await c.end();
}).catch(e=>{console.error(e.message);process.exit(1)});'
```

Write the examples on a card. **Never** project raw customer numbers — hand them to attendees to type
into the search box, or use them from your own (Super Admin) screen where masking is your choice.

---

## Ground rules to state in the first 3 minutes

1. **Interrupt me.** If you don't understand a screen, twenty other people don't either.
2. **This is production data about real customers.** No screenshots to personal phones, no sharing
   numbers outside this room.
3. **You cannot break anything.** The console cannot write to production. The worst you can do is
   create a noisy alert rule — and we'll practise fixing that.
4. **If your screen doesn't match mine, say so immediately.** Usually it's your role — which is a
   lesson, not a problem.

---

## Timing discipline

| Symptom | Fix |
|---|---|
| Running 10 min late by the break | Cut the *last* lab of the day, never the labs — cut talk time |
| Room is quiet / passive | Stop talking. Give a lab. Passive rooms mean you've been talking too long |
| One person is far ahead | Make them a helper: "go check the person on your left" |
| One person is far behind | Pair them; don't hold the room. Offer 15 min after the session |
| A tangent about a specific customer | "Great case — bring it to tomorrow's homework slot" |

---

## When the demo breaks — recovery scripts

### The console is slow or a page won't load
Say: *"Let's use this."* Then, live on the projector:
```bash
cd /apps/console/server && set -a; . ../.env; set +a && node healthcheck.cjs | tail -30
```
Turn it into the lesson: *"This is exactly how you'd diagnose it — indexes, timings, cache, verdict."*
It converts an outage into a credibility moment.

### Dashboards show zeros
Check the **staleness banner** on the projector, then:
```bash
node sync-watchdog.cjs
```
Teach it: *"Rule one — never assume the number is wrong; first ask whether the data is fresh, and
whether the window is right. At 09:00, 'Today' is a small window."*

### The search returns nothing for the example
Use the prep script above to grab a fresh example. Say: *"Older data ages out of the window — that's
why we always pull today's examples."*

### Email/OTP doesn't arrive
Path B in `05-USER-SETUP-RUNBOOK.md` — read codes from the log. Frame it honestly:
*"This is a live infra dependency we're still clearing. It's also a good example of the console being
honest about its own failures rather than hiding them."*

### An attendee's role is wrong
Fix it live in **⚙ → User management** — it's a 20-second demonstration of the permission model, so
narrate it rather than apologising for it.

---

## The questions you will definitely get — with answers

**"Is this replacing our current tools?"**
> No. It replaces the *guessing* — the WhatsApp thread where three teams try to answer one question.
> BSS, ServiceNow and the admin panel all keep their jobs.

**"Can I break production with this?"**
> No. The connection to production is forced read-only at the database level. The console observes;
> humans act in the systems that own the data.

**"Why is the data 5 minutes old? Can it be real-time?"**
> It could be, but real-time means querying production constantly for dashboards — which is exactly
> the load you don't want on the system serving customers. Five minutes is the deliberate trade.
> For anything where seconds matter, the alerting path is what pages you.

**"Who decided these alert thresholds?"**
> They started from observed baselines and have been tuned against real incidents. They are *not*
> sacred — Day 3 teaches you to change them. A rule nobody trusts is worse than no rule.

**"Why can't I see customer numbers?"**
> Because you don't need them for most tasks, and every unmask is logged against a name. It protects
> customers *and* you.

**"What if the console is wrong?"**
> Then we fix it, and it's happened: reseller numbers were once inflated by a bad join; a staleness
> banner once cried wolf on quiet overnight tables. Both were found by someone saying "that number
> looks wrong". **Please be that person.**

**"Do I have to use it?"**
> You have to answer customers and incidents. This makes that faster. If it doesn't, tell me why and
> I'll fix it.

---

## Reading the room — signals to act on

| Signal | Meaning | Do this |
|---|---|---|
| Laptops closed | You've been talking too long | Start a lab now |
| "Can you go back?" ×2 | You went too fast | Recap and slow down |
| Nobody asks anything | Fear or boredom | Ask *them* a question by name |
| Side conversations | Either lost or ahead | "What did I miss?" — usually surfaces a gap |
| Someone quietly not clicking | Stuck, embarrassed | Go over quietly; don't call them out |

---

## Per-day facilitator notes

### Day 1
The goal is **confidence and access**, not coverage. If you finish with everyone logged in, correctly
roled and able to read the dashboard, the day succeeded even if you skipped a module.
Highest risk: accounts and OTP. Budget the extra 10 minutes.

### Day 2
This is the day that changes behaviour. Use **their** homework cases in the recap — nothing lands like
their own unsolved case being solved on screen in 90 seconds.
The stuck-vs-abandoned distinction (Scenario A) is the single most valuable idea in the whole workshop.
Make sure every L1 can state it before you move on.

### Day 3
Optional for L1 after the first hour. This is where L2/L3 take ownership: they leave able to change
the system, not just use it. End by explicitly handing over: *"From now on, you tune these rules."*

---

## Close of workshop — the handover (5 min)

Say this, and mean it:
> "The console is not finished, and it isn't mine. It has been wrong before and it'll be wrong again.
> Every number you can't explain, every alert that wastes your time, every screen that makes you
> guess — tell me. That feedback is what made the parts you like today."

Then agree three concrete things:
1. **Who owns the daily check** (who opens the dashboard each morning).
2. **Where feedback goes** (a channel, a person — decide it in the room).
3. **When you review the alert rules together** (suggest: 30 minutes in two weeks, with real data).

---

## Facilitator's own checklist

**Day before:** pre-flight checks pass · accounts drafted · examples pulled · cheat-sheets printed
· projector tested · deck opens.
**On the day:** terminal open on 152 · OTP log tail running (if Path B) · Troubleshoot open in a spare tab
· scoring sheet ready.
**After each day:** note what confused people (that's tomorrow's recap) · fix any account issues
· pull fresh examples for tomorrow.
