# Day 1 · User & Role Setup Runbook
**Owner: facilitator (Super Admin) · Duration 25 min · Everyone in the room participates**

This is the highest-risk 25 minutes of the workshop: if accounts don't work, nothing else can be
taught. Follow it in order, and use the verification table — *don't assume it worked*.

---

## 0 · Before the room arrives (5 min, alone)

```bash
ssh yosri@172.31.38.152 && sudo su -
cd /apps/console/server && set -a; . ../.env; set +a

# console up?
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4600/

# how will people get their OTP? test it NOW, not in front of the room
node -e '
const nm=require("nodemailer");
nm.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||25),secure:false,
  tls:{rejectUnauthorized:false}})
 .sendMail({from:process.env.SMTP_FROM,to:"y.yahmed.sns@salam.sa",subject:"pre-flight",text:"ok"})
 .then(r=>console.log("MAIL OK:",r.response)).catch(e=>console.log("MAIL FAIL:",e.message));'
```

**Decide now which path you're on:**

| Result | Path | What you tell the room |
|---|---|---|
| `MAIL OK: 250 …` | **A — normal** | "You'll get a 6-digit code by email." |
| `MAIL FAIL: …` | **B — read codes aloud** | "Email is pending an infra ticket; I'll read your code out." |

**Path B command** (keep this in a terminal all session):
```bash
tail -f /apps/console/logs/console.out.log | grep --line-buffered "sign-in code"
```
Each request prints: `[OTP] sign-in code for <email>: 123456 (expires 10m)`

---

## 1 · Create the accounts (facilitator screen, 10 min)

Do this **on the projector** — attendees learn the permission model by watching it applied to themselves.

1. Sign in as **Super Admin** → gear icon **⚙** → **User management**.
2. For each attendee: **+ Add user** → work email → **Name** → **Role** → Save.
3. Say the role's meaning aloud as you assign it (one line each — see the table below).

| Attendee | Role to assign | Say this as you click |
|---|---|---|
| L1 call-centre | `L1 Digital` | "You can see and acknowledge, but not change rules — and customer data stays masked." |
| L1 BSS | `L1 BSS` | "Same powers, BSS team ownership — alerts assigned to your team surface for you." |
| L2 escalation | `L2 Digital` | "You can also edit alert rules. You're who L1 escalates to." |
| L2 BSS | `L2 BSS` | "Same, on the BSS side." |
| Ops lead / reporting | `Report Manager` | "Analytics, SLA and Alerts — read and export. No Troubleshoot, no rule editing." |
| Deep technical | `L3 Digital` | "Everything except user management — **including unmasking PII**, which is audited." |
| Manager | `Report Manager` | "Dashboards and exports; you don't need the failure feed." |

> **Teaching moment — say it out loud:**
> "Notice I am *not* giving anyone Super Admin. Only Super Admin and L3 Digital can unmask customer
> data, and every unmask is written to the audit log with your name on it."

---

## 2 · Everyone signs in (10 min, all together)

Read these steps aloud, one at a time. Wait for the whole room at each step.

1. Open **https://salam.sa/digital-console/**
2. Enter your **@salam.sa** work email → **Send code**
3. *(Path A)* Check your inbox — **also check junk**, first-time sender.
   *(Path B)* I'll read your code out — tell me your email.
4. Enter the 6 digits → you're in.
5. Look at the **top-right corner**: your name and your role label. **Say your role out loud.**

### If someone can't get in

| Symptom | Cause | Fix |
|---|---|---|
| "No console account for this email" | Not created, or typo | Re-check the email in User management — must match exactly |
| "Use a @salam.sa or @salammobile.sa email" | Personal email | Only work domains are accepted — by design |
| Code says invalid | Expired (10 min) or already used | Request a new one |
| Page won't load | VPN / proxy | Confirm VPN; try `https://salam.sa/digital-console/` with the trailing slash |
| Yellow "email delivery failed" | SMTP still blocked | Expected on Path B — code is still valid, read it from the log |

---

## 3 · Verify every account (5 min — do NOT skip)

Have each attendee run their own check and call out the answer. Tick the row.

| # | Attendee | Role shown top-right | Sees **Troubleshoot** tab? | Sees **⚙ Settings**? | Mobile numbers masked? | ✅ |
|---|---|---|---|---|---|---|
| 1 | | Super Admin | yes | yes | can unmask | |
| 2 | | L1 Digital | yes | no | **masked** | |
| 3 | | L1 BSS | yes | no | **masked** | |
| 4 | | L2 Digital | yes | no | **masked** | |
| 5 | | L2 BSS | yes | no | **masked** | |
| 6 | | Report Manager | **no** | no | n/a | |
| 7 | | L3 Digital | yes | yes | can unmask | |
| 8 | | Report Manager | **no** | no | n/a | |

**The two moments that teach the model better than any slide:**

- Ask the **Report Manager** to try to open Troubleshoot. The tab isn't there. *"Least privilege isn't a
  setting we hope people respect — the page simply doesn't exist for that role."*
- Ask an **L1** and the **L3** to open the same Troubleshoot row side by side on the projector.
  L1 sees `05••••••89`; L3 can click **Unmask PII**. Then open **⚙ → Audit log** and show the
  unmask entry that just appeared, with the L3's name on it.

---

## 4 · Set each person's notification preference (3 min)

Still in **User management**, per user: tick **Mail alert** for those who should receive the alert
digest (typically L2s and the ops lead — not every L1, or the digest becomes noise).

Explain the escalation ladder while you're there:

| Severity | 0 min | +10 | +20 | +25 | +45 | +60 |
|---|---|---|---|---|---|---|
| **P1** | L1 Digital | L2 Digital | | L3 Digital | | |
| **P2** | L1 BSS | | L2 BSS | | L2 Digital | |
| **P3** | L1 BSS | | | | | L2 BSS |

> "The ladder stops the moment someone acknowledges. That's the whole point of the Ack button —
> it's not paperwork, it's how you stop your manager's phone from ringing."

---

## 5 · Facilitator's post-lab check (2 min)

```bash
# every account created, with its role — run as Super Admin
curl -s localhost:4600/api/users -H "X-Console-User: y.yahmed.sns@salam.sa" \
 | python3 -m json.tool | grep -E '"email"|"role"|"enabled"'

# who has actually logged in (last_login populated = they're in)
```

Any attendee without a `last_login` has not really signed in — catch it now, not on Day 2.

---

## Appendix · Cleaning up after the workshop

If any accounts were temporary (contractors, observers):

```
⚙ → User management → select user → Disable   (not delete — keeps the audit trail intact)
```

Disabling immediately blocks sign-in: the OTP request is refused for accounts that aren't
`enabled`, and existing sessions fail their next revalidation.
