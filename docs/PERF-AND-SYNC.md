# Performance and data freshness — the permanent design

_v2.0.0-alpha.17 · 7 Sep 2026_

## 1 · Why pages showed "Loading…"
Every heavy page is served through `respCache` (stale-while-revalidate, single-flight). Two things defeated it:
the store lived in memory only (empty after every deploy / restart) and `/api/sync` **cleared** it after every tick,
so the next viewer paid the full recompute (tens of seconds on `/api/home`).

## 2 · What alpha.17 changes (permanent)
| Mechanism | Effect |
|---|---|
| **Snapshot to disk** (`cache/respcache.json`, every minute + on shutdown; restored at boot as *stale*) | first paint after a deploy is instant; the recompute happens behind it |
| **Invalidate = mark stale** (never clear) | after a sync tick, viewers keep getting the previous body while the new one is computed |
| **Keep-warm** (every TTL, top 40 hot URLs that went stale are re-fetched over loopback) | hot pages are fresh before anyone asks |
| **Demo-set warm-up** (★ set replayed 20 s after boot) | covers URLs nobody has requested since the restart |
| `RESP_CACHE_TTL_SEC=300` (recommended; data only changes when a sync ticks, every 5 min) | fewer recomputes, same freshness |

## 3 · Freshness ("data 40 m behind")
The Mobile side reads the **selfcare replica** (`SOURCE_DATABASE_URL`), which is fed by the prod-sync pull
(`PROD_DATABASE_URL`, incremental, read-only). Freshness = pull cadence + replica lag upstream. Rules:
1. **One feeder per replica.** If both consoles point at the same replica database, only one of them runs prod-sync
   (today the digital console). The unified console then needs only its own metrics tick (Settings → Sync,
   *Auto · Live*, 300 s) — no second pull, no double load on prod.
2. **Cadence 5 min, overlap 1 h** on the feeder: `PROD_SYNC_INTERVAL_MIN=5`, `PROD_SYNC_OVERLAP_HOURS=1` (the 6 h
   default re-pulls six hours of rows every tick — fine at 30 min, wasteful at 5).
3. **Cutover:** move `PROD_DATABASE_URL` + `PROD_SYNC_*` to the unified `.env`, set `PROD_SYNC_AUTO=0` on the digital
   console, restart both. The Home "data N m behind" chip then reflects the 5-min cadence plus the upstream replica lag
   — which the console cannot shorten; it is reported honestly ("upstream prod source is running ~N h behind").

## 4 · Retiring the digital console URL
Redirect at nginx on 115, not in the app: `rewrite ^/digital-console/(.*)$ /unified-console/$1 permanent;` inside a
`location ^~ /digital-console/` block above the generic `location /`. Browsers keep the `#route` fragment, so
bookmarks land on the same page. Keep `salam-console` (PM2) running until unified feeds the replica and runs the
collectors — the redirect retires the UI, not the process.
