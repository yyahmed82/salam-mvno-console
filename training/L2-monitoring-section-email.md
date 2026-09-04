# Email to L2 — new Monitoring section (please review & start using daily)

**To:** L2 team (Debasis, Sreekanth, Sandeep)
**Cc:** (as appropriate)
**Subject:** New in the console — "Monitoring" section is LIVE: real-time API health from the Digital-API servers · please review & acknowledge
**Link:** https://salam.sa/digital-console/#monitoring

---

Dear team,

A major addition went live today: the console now has a dedicated **Monitoring** section (second tab, right after Dashboard) that reads the **live API logs directly from both Digital-API servers** — the same data you used to open Grafana for, now inside the console, minute-fresh, and connected to our alerting.

**How the data flows:** the console pulls the `api_logger` production log from both API hosts (master + slave) every minute over a secure read-only channel, classifies every call Business/Technical using our standard, masks customer data, and stores it locally. Nothing is written to the API servers — read-only by design.

**What's on the page:**

**1) Connectivity & health strip** — one card per console dependency: Console API, Replica DB (+ prod-sync age), Console DB, Yusr LLM, OSB MySQL (uil_logs), API GW nodes, ServiceNow, and the API-traffic collector itself. Green = OK, with live latency per check. Two cards are amber **by design** for now, not faults: *API GW nodes 3/6* (two nodes + the DMZ LB are firewalled from the console segment) and *ServiceNow not configured* (integration pending) — no need to raise anything for these.

**2) API health (Grafana-parity)** — the panels you know, now live in the console:
- **Call outcomes** — total / success / failure gauges for the selected window (e.g. 34k calls, 1.0% failure over 24h today).
- **Response-code distribution** — every provider code (00/0000/600 success family, plus 1500, 201, 823 and the rest) so you can spot a code surging at a glance.
- **Duration chart** — average and max response time over the window, UTC axis.
- **Top 20 slowest calls** — exact API, transaction id and duration; your starting point for "why is it slow?"
- **Per-API table** — all ~39 Digital-APIs with volume, Business/Technical failure split and **p95 response time** per API.

**3) Filters** — Window (1h / 6h / 24h), Host (All / master / slave — useful to spot one node degrading), and a per-API dropdown to isolate a single API (e.g. `/bss/mnp/create-port-order`).

**4) Latency alerting (next step)** — response-time thresholds (global + per-API) are wired to fire **Technical** alerts through the normal alert pipeline (ack / assign / notify). Current thresholds are provisional; we're calibrating them this week against the real p95 numbers this page now collects. Expect the first latency alerts after calibration — treat them like any other technical alert.

**What I'm asking from you:**
- Open the page, explore the filters, and **acknowledge in reply** that you can see live data (events counter + "newest ≤1m ago" in the API-traffic card).
- Make it part of the **daily check**: connectivity strip all green (except the two known ambers) + failure % + any API whose p95 jumped.
- When something looks wrong or you want an extra panel/API/threshold, raise it in **Tickets & feedback** ("?" → Raise a ticket) — same flow as agreed, so nothing gets lost.

This closes one of the enhancement items from our sessions (API health visibility without leaving the console). Latency alert calibration lands next.

Best regards,
Yosri
