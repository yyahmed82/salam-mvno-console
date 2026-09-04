# Email to the L2 team — ready to paste

**To:** MVNO-MS-Apps-L2 <MVNO-MS-Apps-L2@salammobile.sa>
**Cc:** *(L2 lead · Ahmed M Awadh · Mohammed A Algarni — adjust as you see fit)*
**Subject:** Digital Console — L2 review sessions, next 3 days (starting today)
**Attachments:** `L2-REVIEW-PLAN.pdf` · `Salam-Console-L2-Review.pptx` · `L2-Review-Log.xlsx`

---

Dear team,

The Digital Console is now live on our production data — dashboards, the order-flow view,
troubleshooting, and 43 alert rules watching payments, activation, eligibility, delivery and the
API gateway.

Before we roll it out to L1, I need it reviewed by the people who can actually judge it. That is
you. L1 will trust whatever the console tells them; you are the ones who can tell when a number is
wrong, when an alert is noise, and when a screen answers the question you actually have during an
incident.

**I'd like to run three working sessions with you over the next three days, starting today.**
Please reply with your availability for today's session and I will send the invites for all three —
same time each day if that works for everyone.

What each session covers (full plan attached):

**Session 1 — Is the data true?**
Where every number comes from, how fresh it is, and the definition behind each box on the order
flow. You sign off (or veto) 12 definitions — including what counts as a stuck payment and how
partner-fulfilled SIMs (tygo/soob) are separated from our own delivery backlog.

**Session 2 — Are the alerts right?**
All 43 rules, threshold by threshold. Each one ends the session as KEEP, CHANGE or DELETE — and we
list what is MISSING. We will also walk through INC0016809 in detail: why the console stayed green
through a P1, and whether the four new BSS rules that came out of it have the right thresholds.
I set those from one incident; you have seen hundreds.

**Session 3 — Is it useful?**
No slides for most of it — you drive. We replay three real incidents against the console
(the BSS 1500 case, the UPG failover mask, Semati flapping) and you tell me, specifically, what
would have saved you time on the real bridge and what was missing. The session ends with a
go / no-go decision for the L1 rollout and a ranked backlog.

**Between the sessions** you use the console on your real cases. Anything that looks wrong, noisy
or missing goes into the attached review log — one line is enough — and we triage it together in a
short stand-up each morning. Findings where the data is wrong get fixed the same day.

Two asks before the first session:

1. Reply with any real case from the last two weeks that was harder to troubleshoot than it should
   have been — we will use them live.
2. If you don't yet have console access, tell me and I will set you up at L2 role before we start.

Be direct in these sessions. A polite review helps nobody — the reseller attribution bug, the
stuck-payment definition and the staleness banner were all found because someone said "that looks
wrong". By the end of the week I want a ranked list of what is wrong, not a list of what is good.

Console: https://salam.sa/digital-console/

Regards,
Yosri

---

## Before sending — 2 minutes

- [ ] Attach: `L2-REVIEW-PLAN.pdf` + deck + review log (all already in `training/`)
- [ ] Adjust Cc to the right leads
- [ ] Propose a concrete time for today in the first line if you already know the slot
- [ ] After replies: create ONE recurring Teams meeting for the 3 days, channel-post it, and paste
      the join link into `workshop.config.json` → rebuild the deck so the links slide is live

(If the plan text changes, regenerate the attachments by asking me — the .md is the source,
the .docx and .pdf are derived from it.)
