# unified-console — working notes for Claude Code

**What this is.** The Salam **Unified Console** (Fixed + MVNO observability), v2.x line of the mvno-console
codebase. Frozen predecessor: tag `v1.1.0-digital-console-freeze` (= what runs at salam.sa/digital-console).
Feature donor: `../../Salam Home/salam-dealer-ops` (Operations Console, Next/tRPC/Prisma) — **read it, never run it here**.
The plan is `docs/UNIFIED-CONSOLE-CONVERGENCE-PLAN.md` — read §0, §2.1 and the current phase before coding.

**Stack.** Node 18 + Express + `pg` (+ `mysql2`, `nodemailer`). Frontend = vanilla JS files at repo root, loaded by
`index.html`, **no build step**. Verify with `node --check`, never with a bundler. Host 152 has no internet.

**Hard rules (plan §2.1).**
- Everything Fixed is namespaced: tables `fixed_*`, modules `server/src/fixed*.js`, routes `/api/fixed/*`,
  metric/rule keys `fixed_*`, views `fixed|maps|b2c`, hash routes `#fixed*`, env `OPS_/NEXUS_/PAYMENTS_DATABASE_URL`.
- Shared features (alerts, errors board, Sub360, analytics, SLO, tickets, audit) get a `segment` dimension
  (`mvno|fixed`), never a copy.
- No deployment name in code: frontend uses `window.CONSOLE_BASE` / `window.API_BASE` (base.js); server uses
  `CONSOLE_PUBLIC_URL`. `grep -rn "digital-console\|unified-console" *.js server/src` must only hit comments.
- Every new pool is optional + read-only + env-gated (pattern: `roPool()` in `server/src/db.js`). Absent env =
  feature says "not configured", never a 500.
- PII: Fixed data is masked at rest in `sda_ops*`; unmask only via `requireCap('unmaskPII')` + `audit('pii.unmask')`,
  fetched live from nexus.
- Time: pools run `timezone=UTC`, process `TZ=UTC`; format for humans with `ksatime.js` (frontend) — never
  hand-roll +3h.

**Local run (prod data through 152, own DB in docker).**
`tools/local/tunnel-152.sh` (keep open) → `docker compose -f docker-compose.unified.yml up -d` →
`tools/local/env-from-152.sh` (once) → `tools/local/dev.sh` → http://localhost:4700/ · check `/api/version`, `/api/fixed/ping`.

**Deploy.** `DEPLOY_TARGET=unified bash deploy152/deploy.sh` (→ /apps/unified, PM2 `salam-unified`, :4700).
`DEPLOY_TARGET=digital` deploys the frozen line — only from branch `release/digital-console`.

**Versioning.** Bump `VERSION` + `server/package.json`, add a `CHANGELOG.md` entry, commit as `vX.Y.Z: …` (VERSIONING.md).

**Where things are.** `server/src/api.js` (routes; Fixed routes mount from `fixed.js`), `db.js` (pools), `roles.js`
(views/caps/roles, `FIXED_ENABLED`), `metrics.js` + `seedRules.js` (alert engine), `errors.js`/`errclass.js`
(error board + Business/Technical SSOT), `sub360.js`, `router.js` + `navcfg.js` (frontend routes/nav).
