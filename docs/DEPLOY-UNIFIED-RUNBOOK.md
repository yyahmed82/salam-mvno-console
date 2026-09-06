# Deploying the Unified Console next to the two prod consoles

_Written 2026-09-06 · applies from v2.0.0-alpha.8_

## 1 · The model: three processes, three private DBs, shared read-only sources

| | Digital Console (frozen) | Operations Console (frozen) | **Unified Console (new)** |
|---|---|---|---|
| URL | salam.sa/digital-console | salam.sa/operations-console | **salam.sa/unified-console** |
| Host / dir | 152 `/apps/console` | 152 `/apps/salam-ops` (+ beta `/apps/salam-ops-beta`) | **152 `/apps/unified`** |
| PM2 / port | `salam-console` :4600 | `ops-web` :4400 · `opsb-*` :4500 | **`salam-unified` :4700** |
| Own DB (writes) | `mvno_console` | `sda_ops` (public) · `sda_ops` beta | **`unified_console`** (new, on 121) |
| Reads | selfcare replica, UPG, Clara, OSB | nexus, payments_v2 | selfcare replica, UPG, Clara, OSB **+ sda_ops public/beta, nexus, payments_v2 — all through read-only roles** |
| Writers of shared data | `prodSync.js` → replica | `ops-ingest-watch`, `opsb-ingest-watch` → sda_ops | **none** (`PROD_DATABASE_URL` empty → prodSync never starts) |

Nothing in the unified deployment touches `/apps/console`, `/apps/salam-ops*`, `mvno_console` or `sda_ops`; the only
shared things are nginx on 115 (one new `location`) and the read-only sources. The two prod consoles cannot see the
unified console at all.

## 2 · Six isolation guarantees (check them, do not assume them)

1. **Own directory, own PM2 name, own port.** `deploy152/deploy.sh` defaults to `DEPLOY_TARGET=unified` → `/apps/unified`, `salam-unified`, :4700. `ecosystem.prod.config.js` reads `PM2_NAME`/`PORT` from `/apps/unified/.env`, so a wrong `.env` cannot silently land on :4600.
2. **Own console DB.** `CONSOLE_DATABASE_URL` → `unified_console`. Sessions, users, roles, alerts, tickets, settings, audit, docs all live there. `boot.js` self-seeds the schema on first start (`server/db/schema.sql`, idempotent).
3. **No second writer on the replica.** `PROD_DATABASE_URL` stays **empty** in `/apps/unified/.env` → `prodSync.js` is inert. Only `salam-console` keeps the selfcare replica fresh. `indexSource.js` only issues `CREATE INDEX IF NOT EXISTS` (idempotent, safe with two readers).
4. **Read-only roles on every shared source.** `OPS_DATABASE_URL` uses `sda_ops_app` with the driver-enforced read-only pool (`db.js`), `OPS_BETA_DATABASE_URL` the same, `NEXUS_DATABASE_URL` = `nexus_reader`, `PAYMENTS_DATABASE_URL` read-only. `OPS_POOL_MAX=1..2` so the beta ingester never starves for connections.
5. **No duplicate side effects during the shadow period.** Alerts evaluate and are stored in `unified_console` (so the 48 h comparison is possible), but nobody is mailed twice: on the user import set `mail_alert=false, mail_report=false` for everyone except the tester(s). Leave `SN_URL`, `SMS_URL`, `SMS_TO`, `WA_BASE_URL`, `API_LOG_HOSTS`, `ZIPKIN_HOSTS`, `SEMATI_PROBE_*`, `IPRL_REDIS_URL` **unset**; keep `SMTP_*` (needed for OTP login). Flip these on only at cutover.
6. **Single-host samplers stay single.** `UILS_SAMPLE=0`, `UILS_WATCH=0`, `OSB_PROBE_AUTO=0`, `APIGW_PROBE_AUTO=0`, `DMS_JOURNEY_SYNC=0` on unified until `salam-console` is retired (they SSH into app nodes and would double the load).

## 3 · Release cadence (how we keep working locally and redeploy per milestone)

- `main` = the unified line, always runnable locally (`tools/local/dev.sh`).
- A milestone = a `CHANGELOG.md` entry + `VERSION` bump + **annotated tag** `v2.0.0-alpha.N` (later `-beta.N`, `2.0.0`). **Only tags are deployed.** Between tags, work freely on `main`.
- `release/digital-console` stays hotfix-only for salam.sa/digital-console (`DEPLOY_TARGET=digital deploy152/deploy.sh`).
- Every deploy: `deploy.sh` syntax-checks all JS, tars, scps, `pm2 delete+start` (so `.env` is re-read), waits for :4700, then you run `postdeploy-check.cjs`. Rollback = check out the previous tag and deploy it again (≈ 1 min) — the DB schema is additive-only (`ADD COLUMN IF NOT EXISTS`), so an older build boots on a newer schema.
- Hotfix on the frozen consoles: branch from `release/digital-console`, deploy with `DEPLOY_TARGET=digital`, cherry-pick into `main` if relevant.
- Web-only changes (JS/HTML/CSS): `deploy152/deploy.sh --web-only` — no restart, users hard-refresh (cache-bust `v=` in `index.html` is bumped per milestone).

## 4 · One-time prerequisites on 121 / 115 (DBA + network)

- `CREATE DATABASE unified_console OWNER <console_app_role>;` on 172.31.15.121 (same role the digital console uses is fine; the schema is self-seeded at first boot).
- Optional but recommended: `pg_dump -t console_users -t console_settings -t analytics_dashboards -t slo_targets -t console_docs mvno_console | psql unified_console` so users keep roles/dashboards, then `UPDATE console_users SET mail_alert=false, mail_report=false WHERE email NOT IN ('<tester@salam.sa>');`.
- nginx on 172.31.38.115: `location /unified-console/ { proxy_pass http://172.31.38.152:4700/; proxy_set_header X-Forwarded-Prefix /unified-console; ... same headers as /digital-console/ ... }` + firewalld rich rule 115 → 152:4700.
- Google Maps key referrers: add `https://salam.sa/unified-console/*`.

## 5 · Post-deploy gate (every milestone)

1. `curl -s https://salam.sa/unified-console/api/version` → expected `VERSION`, `basePath=/unified-console`, `fixedInventory` flags.
2. `node /apps/unified/server/postdeploy-check.cjs` (pools reachable, schema version, rules seeded).
3. Login with OTP; Home shows Mobile + Fixed insights; Fixed › Reports → Salam Home app has data.
4. `pm2 list` still shows `salam-console` :4600 and `ops-web` :4400 **untouched (same pid, same uptime)**.
5. Compare `alerts` fired in `unified_console` vs `mvno_console` for the same window (Mobile side must match).
