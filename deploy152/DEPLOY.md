# Deploy the Digital Console to 152 — runbook

Target: `ruh-salam-site03` / **172.31.38.152**, port **4600**, PM2 under root, no internet on box.
Preflight (2026-08-04): PG 121:5432 ✓ · uil_logs 172.31.43.72:3306 ✓ · SMTP 172.16.1.115:25 ✓ · APIGW/ServiceNow pending SOC (non-blocking).

## 1. Build + ship (on the Mac)
```bash
bash mvno-console/deploy152/build-bundle.sh          # → /tmp/console152.tgz
scp /tmp/console152.tgz yosri@172.31.38.152:/tmp/
```

## 2. Database (one-time, with DBA) — two options
**Option A (recommended): both DBs on 172.31.15.121.** Ask DBA for:
1. A new database `mvno_console` + app account with full rights ON THAT DB ONLY.
2. Read access for the same account to the salam data (either a replica DB he maintains there, or read-only on the prod DB itself → then set `SOURCE_DATABASE_URL` to it directly and leave `PROD_DATABASE_URL` unset — no sync needed; confirm DBA is OK with monitoring read load).
3. If SOURCE is a replica: also a read-only prod account for `PROD_DATABASE_URL` (in-app scheduler pulls every 5 min).

**Option B:** offline Postgres install on 152 (hand-carry RHEL RPMs) — only if DBA refuses app DBs on 121.

## 3. Install on 152
```bash
ssh yosri@172.31.38.152 && sudo su -
mkdir -p /apps/console/logs && cd /apps/console
tar xzf /tmp/console152.tgz
cp env.template .env && vi .env && chmod 600 .env     # fill values (§2 creds, OSB account)
node -e "require('./ecosystem.prod.config.js'); console.log('config OK')"

# firewall: only the reverse proxy (server 115) may reach 4600
firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="172.31.38.115/32" port port="4600" protocol="tcp" accept'
firewall-cmd --reload

pm2 start ecosystem.prod.config.js && pm2 save        # boot.js self-seeds schema+rules, then serves
pm2 logs salam-console --lines 40                     # watch first boot (init: metrics, rules seeded)
```

## 4. Smoke tests (on 152)
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4600/            # 200
curl -s http://localhost:4600/api/sync-health -H "X-Console-User: y.yahmed.sns@salam.sa" | head -c 400
curl -s http://localhost:4600/api/osb/status | head -c 200                 # configured:true if OSB_LOG_URL set
curl -s http://localhost:4600/api/apigw/connectivity | head -c 300         # 43.61 OK now; 43.9/.10 after SOC
```
FIPS note: if boot crashes with an OpenSSL/digest error, capture the log — needs a crypto shim (not expected; ops app runs fine).

## 5. Publish via nginx on server 115
Add on 115 (mirror the existing 4400 app's block):
```nginx
location /console/ {                     # or a dedicated server_name
    proxy_pass http://172.31.38.152:4600/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```
`nginx -t && systemctl reload nginx`. If upstream refused: `setsebool -P httpd_can_network_connect 1`.

## 6. After SOC tickets clear (no action needed)
APIGW probe tiles (43.9/.10:8443) and ServiceNow correlation activate automatically — verify with the `/api/apigw/connectivity` curl and Settings → integrations.

## Known limitations on 152 (by design — no internet)
WhatsApp/Teams/Slack chatops, Tap reconciliation, Unifonic SMS are OFF (external). Working: email alerts (internal SMTP), in-console alerts/escalation, OSB fault watcher, Yusr (LLM answers only if Ollama is installed on-box — hand-carry binary + llama3.1 model ~5GB; without it Yusr serves data-driven fallback answers).
