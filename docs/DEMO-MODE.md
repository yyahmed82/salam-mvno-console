# Demo mode — record once, replay instantly

_v2.0.0-alpha.17 · Settings → Demo mode (`#settings-demo`) · `server/src/demo.js`, `democfg.js`_

## Why
A demo cannot depend on a cold cache, a lagging replica or a slow LLM. Every page of the console is vanilla JS calling
`GET /api/…`, so the cheapest way to make **all** of them instant is to intercept at that boundary.

## How it works
| Mode | What happens |
|---|---|
| **Record** | Every 200 JSON response the pages fetch (GET, plus `POST /api/assist/chat`) is stored in the named set: `demo_snapshots(set, method, key, body, captured_at)`. Key = path + sorted query (volatile params `_ t ts nocache token cb` dropped); Yusr key = normalised question text. |
| **Replay** | Same key → stored body in ~1 ms, timestamps shifted by *now − captured_at*. Not recorded → live. Writes (ack, ticket, block, rule edit) → recorded answer or `{ ok:true, demo:true, message:"Demo mode — nothing was changed" }`. |
| **Off** | Live data. |

Scope is **per signed-in user** (`demo_users.email`) — your colleagues keep live data while you present. Prod tables are
never written; the only new tables are `demo_sets`, `demo_snapshots`, `demo_users`.

Indicator: violet dot on the ⚙ gear while replaying, red blinking dot while recording. Nothing else in the chrome changes.

## Recording checklist (the order the CIO demo follows)
Home → Mobile dashboard → Monitoring (Gateway, Payments, Access) → Alerts → Fixed overview → SDA map → Errors (open a
row, *Open full trace*) → Fixed alerts → Customer 360 with your number (Mobile and Fixed) → Tickets → Yusr (ask the
3–4 questions you will ask on stage, with the wording you will use). The Coverage panel shows what the set holds.
Re-record a single page later by pressing Record on the same set and opening only that page.

## Warm-up (helps real prod, not only the demo)
Mark one set ★. Twenty seconds after every boot the server replays its GET keys against itself (loopback, `X-Demo-Bypass`)
so the real handlers run and `respCache` fills: the first Home paint after a deploy is fast for everyone. `DEMO_WARMUP=0`
turns it off; "Warm cache now" runs it on demand.

## Before the demo
1. Record the set the day before, with the data you want to show (recording takes the real time each page needs).
2. Export the set (JSON) — a copy you can import on another server or after a DB reset.
3. On the day: Settings → Demo → Replay → the console reloads on Home. Present. Switch Off afterwards.

## Limits
Binary exports (PDF / XLSX) and SSE streams are not recorded — they run live. Responses over 4 MB are not stored.
