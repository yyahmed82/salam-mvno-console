# Email to L2 — ticket resolution + console update since 13 Aug

**To:** Debasis Sahoo, Sreekanth Tanakalacheruvu, Sandeep Baswal
**Cc:** Alanoud E Alharbi
**Subject:** Re: Digital Console — your ticket resolved + what's new since 13 Aug (and a request before the L1 workshops)

---

Dear Debasis, team,

**First — thank you, Debasis.** You raised the first real ticket through the console's own Tickets & feedback module (TKT-000002, *"Details information in Alert definition"*), exactly the way we agreed. It was precise, actionable, and it produced a genuine improvement to the product. That is the loop working as intended.

## 1) Your ticket — resolved

You asked for three things: transparency on what triggers each alert, fewer false triggers, and business/technical separation for faster prioritisation. All three are now in place.

**Alert definitions now state exactly what triggers them.** Every rule carries a new **"Trigger codes"** field, visible in three places:
- **Alerts → Rules** — a new TRIGGER CODES column
- **On the incident itself** — a "Triggered by: …" line inside the Guided Response box
- **Yusr** — ask *"why did semati_flapping fire?"* and you get the definition, trigger codes, thresholds and the 14-day firing history

33 rules are documented, each stating the business/technical boundary explicitly, for example:
- `semati_flapping` → *Semati 715/5002 alternating with success · excludes business declines*
- `app_crash_surge` → *-501 **with** a Ruby exception (unhandled crash) · plain -501 is counted as backend instead*
- `app_auth_fail_surge` → *-201/-202/-203/-204/-205 tokens · -300/-301 login · -612 password*

**Over-triggering — measured, then fixed.** Rather than guess, we pulled 14 days of firing statistics and looked at *breach evaluations per fire*. An alert that re-breaches 100+ times before resolving is describing a normal condition, not an incident:

| Rule family | Fires (14d) | Breaches per fire | Action |
|---|---|---|---|
| Anomaly volume signals (onboarding, checkout, eligibility, nafath) | 142 | 133–159 | sensitivity 3.5σ → 5σ, volume floor 60 → 300/hr, capped to P3 (watch-only) |
| semati_flapping | 304 | 105 | → P3, threshold raised |
| tap_hard_down / hyperpay_hard_down | 276 | 106 / 12 | minimum-sample guard (they fired during natural low-volume gaps) |
| payment_zatca_gap | 122 | 14 | threshold 800 → 1500 (backlog sits ~500 in steady state) |
| volume_drop, payment_web_fail, nafath_fail_spike, recharge_fail_spike, api_latency_per_api | ~240 | 31–71 | minimum-sample guards / widened bars |

Real incidents still page — a true Semati outage or volume collapse is 8–15σ, far above the new bars.

**Business vs technical** was already delivered from the Session-2 feedback: every rule is tagged **business** (the API answered "no" — declines, refusals, validation) or **technical** (the platform failed to answer — timeouts, 1500/5xx, outages), with no mixed rules; blended ones were split into independently enable/disable-able pairs, and the class is filterable on both the Alerts board and Troubleshoot.

## 2) What's new in the console since my 13 Aug note

**Monitoring**
- **Latency alerting calibrated** (the "next step" I promised on 13 Aug): thresholds now set from real p95 data — global 3,000 ms plus 15 per-API overrides for the legitimately slow BSS calls, so slow-by-design APIs don't page.
- **New section ③ — App errors · IP rate-limiting.** A second log source from both API servers (the application's own error log) with: the complete **error-code catalogue generated from the application source — all 137 codes** with constant name, meaning and category; clickable category chips; an hourly stacked chart; daily history since 1 Aug; a custom date/time filter; and a dedicated IP rate-limiting panel showing blocks per hour, top blocked IPs and the live limiter settings.
- **New section ④ — SMS · Notifications.** OTP funnel (sent → verified, verify rate, average time-to-verify, retry storms), the active SMS vendor, and a gateway reachability probe executed from the API hosts.

**Troubleshoot**
- **Case analyzer** — paste the *Device ID* shown in the app's error dialog (it is the trace id) and get the full diagnosis: every backend event for that customer's request, the exception and the exact code file/line, plus a known-case explanation and recommended action. Also works by pasting the whole error text.
- **UPG / payments deep-dive** — a final-outcome funnel per gateway (success · abandoned · declined · stuck), retry-success within 24h, decline reasons and a 14-day abandonment-vs-decline trend. It distinguishes *charge attempts* from *final outcomes*, which is what settled the April UPG escalation.
- Drilling from a Dashboard KPI into Troubleshoot now carries the **selected period and the business/technical class** across.

**Yusr**
Yusr now answers four new question types directly: a **trace/case** ("what happened in this case?"), an **error code** ("what is error -113?" → meaning, category, live counts), **SMS/OTP health** ("is there an OTP delivery issue today?" → degraded hours, start/end, impact, whether it is still happening), and **alert definitions** ("why did semati_flapping fire?").

**Topology & documentation**
- **Topology 2 (beta)** — a source-linked map: click any component or flow to see the API contract, a **live masked sample request/response from the replica**, timing statistics, failure cases, and the exact source references (class · file · line · methods · dependencies). The Payments domain is complete; other domains follow.
- **API Gateway** page now embeds the full HLD (all tiers, hosts, IPs, DNS) with live node status.

**Fixes from your feedback and from live cases**
- The 30-day dashboard freeze is fixed (charts render progressively).
- A classifier correction: one API's success responses were being counted as technical failures — the technical-error figure is now clean.

These tools have already paid for themselves: the CCO postpaid-payment case (error -501) was root-caused in minutes with the Case analyzer, and the April UPG "failures" escalation was answered with per-transaction evidence rather than opinion.

## 3) Please contribute the same way

Debasis's ticket is the model. **Every remark — big or small — please raise it in the console:** "?" → *Raise a ticket* (or "＋ New ticket" on the Tickets board), choose Suggestion or Issue, attach a screenshot. You get a reference and email updates as the status changes, and nothing is lost in side chats. Sreekanth, Sandeep — I would very much like to see tickets from you too; the review found things I would never have found alone.

## 4) Ask for this week — before the L1 workshops

We are preparing the **L1 workshop series**, and L1 will trust whatever the console tells them. So this week, please:

1. **Use the console on your real cases** and log anything wrong, noisy or missing as a ticket.
2. **Judge the alerts specifically** — after the tuning above, tell me if any rule is still noisy, or if something you would want paged is *missing*.
3. **Tell me what L1 will need** — which screens they will live in, what must be simpler, and which runbook steps must be spelled out. Your two review sessions shaped the console; they should shape the L1 material too.
4. **Keep rating Yusr's answers** (👍/👎) — every rating teaches it your proven solutions.

If it is easier to walk through it together, I am happy to schedule a short session this week.

Thank you again — particularly to Debasis for setting the standard on how to give the feedback.

Best regards,
Yosri
