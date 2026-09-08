# Alert mail — how a firing rule reaches an inbox (Mobile and Fixed)

_v2.0.0-alpha.15 · 7 Sep 2026_

## The chain

```
tick ──▶ syncOnce()            metric_snapshots for every (metric, window) an enabled rule needs
     ──▶ runAlerts()           compare → open / update / resolve rows in `alerts` (segment mvno | fixed)
     ──▶ opened > 0 ?          ──▶ notify.sendAlertDigest()   one mail to every user with mail_alert = true
                                     ├─ buildDigest()          intro + table, one row per rule
                                     └─ alertReport.buildFiredReports()   one PDF per FIRING rule (max 6)
```

Two things can be the **tick**, and exactly one of them must own the loop on a given server:

| Tick | When | Mails? |
|---|---|---|
| `prodSyncScheduler` → `POST /api/sync` | `PROD_DATABASE_URL` set and `PROD_SYNC_AUTO` ≠ 0 (every `PROD_SYNC_INTERVAL_MIN`, default 30) | yes — this is how the digital console mails in prod |
| Settings → Sync scheduler (`settings.js tickOnce`) | mode `Auto · Live`, interval in seconds | yes since alpha.15 — **only when prod-sync is not armed** |

Fixed rules need no prod sync: their metrics read `sda_ops` through the OPS pool at evaluation time. Mobile rules need the
prod pull (the selfcare replica is what the metrics are computed from). On 152 the unified console boots with
`[PROD-SYNC] no PROD_DATABASE_URL — auto-sync disabled` and `scheduler: manual (stopped)` → **nothing evaluates, nothing
mails** until one of the two ticks is armed.

## What the mail carries

| | Mobile (MVNO) rule | Fixed rule |
|---|---|---|
| Row chip | 📱 MOBILE | 🏠 FIXED |
| "Open ›" | `#alerts?id=<incident>` (or `?rule=`) | `#fixed?tab=alerts` |
| Inspect link | — (the PDF names the API) | per rule, `fixedLinks.js`: map pre-filtered (Nafath / Semati / stalled), error board, Fixed dashboard |
| PDF evidence | `api_traffic_events` — endpoints, response codes, real request/response example | `sda_ops` — failing 5G attempts / open error events / incident tickets of the rule's theme |
| PDF console links | `#alerts`, `#troubleshoot` | `#fixed?tab=alerts` + the inspect link |

The map deep link (`#fixed?tab=map&plans=…&nafath=not_completed&range=24h`) is what the retired Operations Console mailed
as "Inspect in console →" (`salam-dealer-ops alerts.ts inspectLink`), on the unified routes; `fixed-map.js` applies the
filters once per distinct query string.

## Recipients

`console_users.mail_alert = true` — nothing else. Every imported account landed with it **off** (alpha.13), so during the
shadow period only the people you switch on in Settings → Users receive the unified digest while the two prod consoles
keep mailing their lists.

## Verify on a server

```bash
cd /apps/unified/server && set -a; . ../.env; set +a
node src/cli.js testmail fixed_nafath_fail_spike y.yahmed.sns@salam.sa     # Fixed: map link + sda_ops evidence PDF
node src/cli.js testmail payment_fail_rate    y.yahmed.sns@salam.sa     # Mobile: incident link + API-capture PDF
```
Subject is prefixed `[TEST]`, the simulated row is marked **(SIMULATED — test mail)**, and only that address is mailed.

## Business segregation (8 Sep 2026)

One definition, `server/src/segment.js`: a rule / firing is **Fixed** when `alert_rules.segment='fixed'` or its key starts
with `fixed_` (the schema backfills the column at boot); everything else is **Mobile (mvno)**.

| Surface | Mobile team sees | Fixed team sees |
|---|---|---|
| Mobile › Alerts (`/api/alerts`, `/api/rules`, `/api/alerts/summary`, `/api/incidents/stats`) | mvno only | (page hidden by business scope; API answers Fixed for a fixed-only user) |
| Fixed › Alerts (`/api/fixed/alerts/*`) | — | fixed only |
| Alert mail | `[Salam Ops · Mobile] N alert(s)` | `[Salam Ops · Fixed] N alert(s)` |

Recipients of each mail = enabled users with **Mail alert ON** whose `console_users.business` covers the side:
`mobile` → Mobile mail only · `fixed` → Fixed mail only · `both` → both mails (Settings → Users → BUSINESS).
A side with nothing firing sends nothing. Each mail carries only its own PDFs and console links. Test mail
(Settings → Notifications / `node src/cli.js testmail <rule-key> <email>`) sends the side that contains the rule, `[TEST]`-prefixed.
`?segment=fixed|all` on the Mobile endpoints is honoured only for `both` users (ops / super admins).
