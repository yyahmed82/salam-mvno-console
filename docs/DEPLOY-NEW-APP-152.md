# Runbook — put a new application live on 152 behind salam.sa (152 + 115)

_The exact path the unified portal took on 6 Sep 2026, written once so the next app takes an hour, not a day._
_Placeholders: `<app>` (short name, e.g. `myapp`), `<PORT>` (free port on 152), `<path>` (public path, e.g. `/myapp`)._

## What you are working with

| Host | Role | Facts that bite |
|---|---|---|
| **152** `ruh-salam-site03` (172.31.38.152) | runs the Node apps under PM2 | **no internet** (ship `node_modules` in the bundle), **no psql** (use the app's own `sql.cjs`), **no firewalld**. Ports taken: 4400 `ops-web`, 4500 `opsb-*`, 4600 `salam-console`, 4700 `salam-undertaking`, 4701 `salam-unified` |
| **115** `ruh-getapigwp01` (172.31.38.115) | nginx for salam.sa — one `location` per app in `salamsite.conf` | back the conf up before editing; `nginx -t` before reload |
| **121** (172.31.15.121) | PostgreSQL | app roles cannot `CREATE DATABASE` — create the DB in pgAdmin as admin, owner = the app role |

Everything below is run **as root on 152** unless the heading says 115 or 121.

## 1 · Pick a port and a directory (152)

```bash
ss -ltnp | grep -E ':(4[0-9]{3}) ' | awk '{print $4, $NF}' | sort
```
Choose a `<PORT>` that is not listed. Then:

```bash
mkdir -p /apps/<app>/server /apps/<app>/web /apps/<app>/uploads && ls -la /apps/<app>
```

## 2 · Database (121, pgAdmin as admin) — skip if the app has no DB

```sql
CREATE DATABASE <app>_db OWNER console_app;
```
(Reuse `console_app` unless the app needs isolation; a new role needs `GRANT CONNECT` + schema grants.)
If the app reads another app's DB, grant **SELECT only**:
```sql
GRANT CONNECT ON DATABASE <other_db> TO console_app;
\c <other_db>
GRANT USAGE ON SCHEMA public TO console_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO console_app;
```

## 3 · `.env` (152) — start from a working one, never from scratch

```bash
cp /apps/unified/.env /apps/<app>/.env && chmod 600 /apps/<app>/.env && vi /apps/<app>/.env
```
Set at minimum: `PORT=<PORT>`, `PM2_NAME=salam-<app>`, `BASE_PATH=<path>` (if the app is path-mounted),
`CONSOLE_DATABASE_URL=postgresql://console_app:<pass>@172.31.15.121:5432/<app>_db`, `UPLOAD_DIR=/apps/<app>/uploads`.
Remove every collector / notifier the new app must not run (`SN_URL`, `SMS_*`, `WA_*`, `API_LOG_HOSTS`, `ZIPKIN_HOSTS`, `*_AUTO=0`) — a copied `.env` is how a shadow app starts paging people.

## 4 · Ship the code (from your Mac)

The unified repo's `deploy152/deploy.sh` already does syntax-check → tar (with `node_modules`) → scp → untar → `pm2 delete+start` → wait for the port. For a new app, copy it and change the three variables at the top:

```bash
cd ~/Documents/Claude/Projects/<repo> && cp ~/Documents/Claude/Projects/"Salam DMS"/unified-console/deploy152/deploy.sh deploy152/deploy.sh && sed -n '1,25p' deploy152/deploy.sh
```
Edit `TARGET`, `APP=/apps/<app>`, `PM2NAME=salam-<app>`, `PORT=<PORT>`; then:
```bash
DEPLOY_TARGET=<app> bash deploy152/deploy.sh --full
```
(`--full` ships `node_modules`; needed on the first deploy and whenever `package.json` changes. 152 cannot `npm install`.)

Manual equivalent, if the app is not a copy of the console:
```bash
# Mac
cd ~/Documents/Claude/Projects/<repo> && npm ci --omit=dev && COPYFILE_DISABLE=1 tar --no-xattrs -czf /tmp/<app>.tgz --exclude=.git . && scp /tmp/<app>.tgz yosri@172.31.38.152:<app>.tgz
```
```bash
# 152
tar xzf /home/yosri/<app>.tgz -C /apps/<app> && ls /apps/<app>
```

## 5 · PM2 (152)

```bash
cat > /apps/<app>/ecosystem.prod.config.js <<'EOF'
require('dotenv').config({ path: '/apps/<app>/.env' });
module.exports = { apps: [{
  name: process.env.PM2_NAME || 'salam-<app>',
  cwd: '/apps/<app>/server',
  script: 'src/index.js',            // ← the app's entry point
  env: { NODE_ENV: 'production', PORT: process.env.PORT || '<PORT>' },
  max_memory_restart: '1500M', time: true, autorestart: true,
}]};
EOF
cd /apps/<app> && pm2 start ecosystem.prod.config.js && pm2 save && pm2 list
```
(If the app has no `dotenv`, put `PORT=<PORT>` directly in `env:`.)

## 6 · Verify locally on 152 before touching nginx

```bash
sleep 5 && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:<PORT>/ && pm2 logs salam-<app> --lines 30 --nostream
```
Expect `200` (or `302` to a login page). Fix here first — nginx only adds a layer.

## 7 · nginx (115)

```bash
F=$(grep -rl "digital-console" /etc/nginx/ | head -1); echo "$F"; cp "$F" "$F_$(date +%d_%m_%Y)" && grep -n "location .*unified-console" -A 14 "$F"
```
Copy the printed `/unified-console/` block, paste it **above** the generic `location /` in the same `server {}` and change exactly three things — the path, the port, the prefix:

```nginx
    location ^~ <path>/ {
        proxy_pass http://172.31.38.152:<PORT>/;
        proxy_set_header X-Forwarded-Prefix <path>;
        # …keep every other proxy_set_header / timeout line exactly as in the /unified-console/ block…
    }
```
Then:
```bash
nginx -t && systemctl reload nginx && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1<path>/
```
No firewall rule is needed 115 → 152 (152 runs no firewalld). If 115 itself filters egress, mirror whatever was done for `:4701`.

## 8 · Public check

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://salam.sa<path>/ && curl -s https://salam.sa<path>/api/version 2>/dev/null | head -c 300; echo
```
Then open `https://salam.sa<path>/` in a browser — hard refresh (⌘⇧R) — and confirm the **other** apps still answer:
```bash
pm2 list && for p in 4400 4600 4701; do curl -s -o /dev/null -w "$p %{http_code}\n" http://127.0.0.1:$p/; done
```
Same pids and uptimes as before = nothing else was touched.

## 9 · Redeploy / rollback

Redeploy = re-run step 4 (tag the milestone first). Rollback = check out the previous tag and deploy it again; keep DB changes additive (`ADD COLUMN IF NOT EXISTS`) so an older build boots on a newer schema.
```bash
pm2 restart salam-<app> && pm2 logs salam-<app> --lines 20 --nostream      # restart only (re-reads .env)
pm2 delete salam-<app> && pm2 save                                           # retire the app
```
Retiring the app: remove its `location` block on 115 (`nginx -t && systemctl reload nginx`), then delete the PM2 entry.

## Gotchas we already paid for

- `.env` is read at start only: any change → `pm2 restart salam-<app>` (the deploy script does `delete+start` for this reason).
- `cp: target '/apps/<app>/server/src/' is not a directory` → the tree did not exist yet; step 1 creates it.
- The port you assumed is free is not (4700 was `salam-undertaking`) → step 1 is not optional.
- `permission denied to create database` → the app role cannot create DBs; pgAdmin as admin (step 2).
- First boot of a console-lineage app can take minutes (schema self-seed, rollup backfill) — watch `pm2 logs`, do not restart it mid-way.
- Google Maps key: add `https://salam.sa<path>/*` to the key's referrers or the maps stay grey.
