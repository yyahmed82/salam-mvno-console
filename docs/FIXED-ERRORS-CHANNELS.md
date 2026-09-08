# Fixed › Errors — channels, product type, sources

_alpha.18 · 2026-09-08_

## What the board shows
Every Fixed sales & service channel, one event per failing step, live (60 s refresh):

| Channel chip | Meaning | Read model |
|---|---|---|
| **SDA (dealer)** | dealer app journeys (ftth · fttb · fiveGWhiteLabel · fiveGFWA · promoters) | `sda_ops` (`OPS_DATABASE_URL`) |
| **QR codes** | e-purchase web flow opened from a dealer / campaign QR — `channel='epurchase'` **with** a referral code | `sda_ops` |
| **Web e-purchase** | public e-purchase, consumer-direct — `channel='epurchase'` **without** a referral code | `sda_ops_beta` (`OPS_BETA_DATABASE_URL`) |
| **Salam Home app** | Pulse app — buy FTTH + manage-line (freeze, relocation, change plan, renew) — `channel='salamhome'` | `sda_ops_beta` |

Why two sources: both are read models of the same nexus stream, but the **prod ingest (`ops-ingest-watch`) still
maps PULSE → `epurchase`**, so in `sda_ops` a referral-less e-purchase row is *either* a web order *or* an app journey —
indistinguishable. That is why the old board excluded "consumer-direct" altogether. The **beta ingest
(`opsb-ingest-watch`)** maps PULSE → `salamhome`, stores consumer-direct and knows the salamHome* workflows.
The board therefore reads SDA + QR from prod (matches the map, alerts and dashboards) and Web + app from beta, and never
the same bucket from both — no double counting, nothing hidden. Event ids are deterministic hashes (attempt · step ·
code · time), identical in both models, so acks (console DB) apply either way.

If `OPS_BETA_DATABASE_URL` is unset, everything comes from `sda_ops` and "Web e-purchase" then contains the folded app
journeys — the board says which model serves which bucket in the left card, with the age of the latest event (red > 2 h
or unreachable). **Both watchers must keep running** (`pm2 list`: `ops-ingest-watch`, `opsb-ingest-watch`).

## Type
Product of the journey, from `order_attempts.workflow` first, then the plan text:

| Type | Workflows / hint |
|---|---|
| FTTH | `ftth` · `ePurchaseFTTH` · `salamHomeRelocationFTTH` · plan ~ ftth / fiber |
| FTTB | `fttb` · plan ~ fttb / business |
| 5G HomeFi | `fiveGWhiteLabel` · `salamHomeRelocationWL` · `salamHomeRelocationOwn` |
| 5G FWA | `fiveGFWA` |
| 5G (plan) | workflow silent, plan text says 5G (freeze / renew of a 5G line) |
| Lead | `promoters` |
| Unknown | no attempt row or no product hint |

Salam Home rows also show the journey (Relocation · Freeze · Unfreeze · Change plan · Pre → post · Renew).

## API
`GET /api/fixed/errors/{summary,live,export}` accept `channel=sda|qr|web|salamhome` (legacy `epurchase` = QR + Web) and
`type=ftth|fttb|5gwl|5gfwa|5g|lead|unknown`; `summary` returns `byChannel`, `byType`, `sources[]`; rows carry
`chan`, `type`, `workflow`, `journey`, `src`; `detail?id&src=` reads the row's own model; `live` pages by `cursor` = ISO
time of the last row.

## Verify on 152
```
set -a; . /apps/unified/.env; set +a; node /apps/unified/server/check-fixed-sources.cjs 24
```
prints, per model, the channel buckets with latest event, the workflows behind web / app (salamHome* under "web" in
`sda_ops` = the fold described above), the type mix and the coverage window.
