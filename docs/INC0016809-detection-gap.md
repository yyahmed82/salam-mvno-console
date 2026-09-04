# INC0016809 — why the console stayed green through a P1

**06 Aug 2026 · BSS 1500 SOAP faults · firewall upgrade CRQ000000190352**

## What happened

| Time (KSA) | Event |
|---|---|
| 05:00 | Cyber-Security firewall upgrade completes (CRQ000000190352) |
| 05:00–05:30 | Connectivity breaks on 172.20.10.194 → 172.20.8.56. BSS starts returning SOAP Faults |
| 06:23 | P1 INC0016809 raised — "1500 errors in some BSS APIs" |
| 06:50 | BRM components restarted to mitigate |
| 07:07 | Grafana shows 42 × response-code 1500 in 30 min |
| 07:49 | **Digital Console shows 3 open alerts — none of them this** |

Impact: activation flow, plan renew, and login.

The fault payload:

```json
{"responseCode":"1500",
 "responseMessage":"unexpected XML tag. expected: {…}createSubscriptionTransactionResponse
                    but found: {http://schemas.xmlsoap.org/soap/envelope}Fault"}
```

## The correction that matters

There are **two different 1500s**, and we had been treating them as one:

| | READ path | WRITE path |
|---|---|---|
| APIs | `list-invoices`, `get-account`, `get-sub` | `createSubscriptionTransaction` |
| Fault | `OSB-382000 — Client received SOAP Fault` | `unexpected XML tag … but found: Fault` |
| Logged in | `logs.uil_logs` (OSB layer, separate MySQL) | **`activation_logs` — our own replica** |
| Visible to console | No — needs `OSB_LOG_URL` | **Yes, all along** |
| Cause on record | IMPACT R7.2 Siebel CNE go-live | Firewall upgrade CRQ000000190352 |

INC0016809 was the **write path**. The data was in the replica the whole time. This was not a
missing-feed problem — it was a missing-rule problem, which is worse, because it was ours to fix.

## Why nothing fired

Three independent gaps, each sufficient on its own:

1. **No rule read the BSS response code.** `activation_logs.response->>'responseCode'` was surfaced
   in the Troubleshoot breakdown but no metric consumed it, so a code that is *never* normal could
   appear 42 times in 30 minutes without being evaluated.

2. **The one rule that could have noticed was gated out.** `activation_fail_storm` needs ≥70% failure
   with `min_sample: 20` over 1h. At 07:00 KSA activation ran n=13 at 46% — below the sample floor,
   and below the threshold anyway.

3. **That 70% threshold is not a mistake — it's a symptom.** `activation_fail_rate` mixes BSS and
   Semati calls. Semati fails ~45–55% chronically, so the threshold had to clear that noise, which
   made the rule structurally blind to BSS faults. Lowering it would have produced constant false
   alarms instead.

## What changed

Four new metrics, four new rules. All computed from tables already in the replica — **no dependency
on the OSB feed**.

| Rule | Sev | Fires when | Closes gap |
|---|---|---|---|
| `bss_soap_fault_1500` | **P1** | ≥5 SOAP faults / 30 min | 1 — reads the response code directly |
| `bss_degraded` | P2 | ≥25% BSS failure / 1h, Semati excluded | 3 — clean baseline, sensitive threshold |
| `bss_fail_burst` | P2 | ≥6 BSS failures / 30 min | 2 — count-based, no denominator to starve |
| `bss_error_dominant` | P3 | one code ≥60% of failures | early warning; names the code in the alert |

The design decision worth remembering: **`bss_fail_burst` counts failures instead of rating them.**
A rate needs a denominator, and at 07:00 KSA the denominator was 13. A count has nothing to be
starved of — six failures is six failures at 03:00 and at 13:00 alike.

Semati is excluded from all four. Semati problems are not lost; they fire on
`semati_unavailable` / `semati_flapping`, which are tuned to Semati's own baseline.
(Historical note: `activation_fail_storm` kept its 70% threshold at the time because it guarded a
*blended* BSS+Semati metric and lowering it would have reintroduced the noise. On 2026-08-11 that
rule was retired and split into `activation_fail_storm_technical` / `activation_fail_storm_business`
over Semati-excluded, class-filtered metrics — the blended metric no longer drives any rule.)

## Verified

SQL parsed against the real PostgreSQL grammar (pglast); rules replayed through the actual
`alertRunner` comparator, not a reimplementation.

```
 3 SOAP faults / 30 min  → SILENT
 5 SOAP faults / 30 min  → FIRES P1
14 SOAP faults / 30 min  → FIRES P1
42 SOAP faults / 30 min  → FIRES P1     ← the observed volume
 0 faults (normal day)   → SILENT
 2 faults (transient)    → SILENT
```

Low-volume and quiet-hours checks on the other three:

```
06 Aug 07:00, BSS 6/13 failed (46%)   bss_degraded FIRES · bss_fail_burst FIRES · dominant FIRES (code 1500)
quiet night, 1/2 failed (50%)         all three SILENT
busy hour,  12/400 failed (3%)        all three SILENT
```

**Detection latency:** the threshold is reached within minutes of 05:00. INC0016809 was raised at
06:23. The console would have opened a P1 roughly an hour before the bridge call.

## Still open

- **OSB feed** — `OSB_LOG_URL` unset, so read-path 1500 / OSB-382000 remains invisible. Blocked on
  SOC connectivity to the OSB MySQL host (172.31.43.72). Separate fault, still worth chasing.
- **`osbProbe` threshold** — defaults to 300 faults / 10 min, set without data. Grafana showed 42 per
  30 min during a live P1. Recalibrate before the feed goes live or it will stay silent too.
- **`osbProbe` posts to ChatOps but never writes an incident row**, so even when it fires nothing
  appears on the Alerts page. Route it through the incident engine.

## The general lesson

A threshold inherited from a noisy metric is a blind spot with a number on it. When a rule has to be
set high to survive a chronic baseline, that is a signal to **split the metric**, not to accept the
insensitivity. Ask of any rule: *what would it take for this to stay silent through a real incident?*
Here the answer was "a quiet Thursday morning" — and that is exactly when it happened.
