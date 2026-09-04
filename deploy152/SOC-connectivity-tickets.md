# Digital Console on 152 — SOC connectivity requests

## ✅ Preflight results (run on 152, 2026-08-04)
Already OPEN — no ticket needed: **172.31.15.121:5432** (prod Postgres, 3ms) · **172.31.43.72:3306** (Clara MySQL — the uil_logs host, 7ms) · **172.31.43.61:3000** (APIGW DMS entry) · **172.16.1.115:25** (internal SMTP).
Blocked — SOC tickets requested via Abdulbasset (2026-08-04): 172.31.43.9:8443, 172.31.43.10:8443, servicehub.salam.sa/167.208.4.47:443 (+ optional 172.31.42.23/.24:8443).
No ticket: LB VIP 45.1 was REFUSED on 443 (port, not firewall); Clara VIP 172.16.1.115:3306 blocked but node .72 works; EXTERNAL fails expected (no internet).
Inbound: proxy host = **server 115**, already allowed to 152 (existing app on 4400). For the console: local firewalld rich-rule on 152 (source 115/32 → 4600) + nginx upstream on 115 — our side, no SOC.

App: **Salam Digital Console + Yusr chatbot**, host `ruh-salam-site03` / **172.31.38.152**, runtime Node 18 + PM2 (per 152 deploy reference). All flows below are **outbound TCP from 172.31.38.152** unless marked inbound. Everything the app does over these flows is **read-only monitoring** except its own two databases.

> Before raising: run `node connectivity-check.cjs` on 152 — only raise the rows that show TIMEOUT/BLOCKED. REFUSED means the port is wrong, not the firewall.

## A. Required — app cannot run without these

| # | From | To | Port | Purpose |
|---|------|----|------|---------|
| 1 | 172.31.38.152 | **172.31.15.121** | 5432/tcp | Postgres — prod-sync source (read-only account) and/or app databases |
| 2 | *nginx proxy host* → | 172.31.38.152 | **4600**/tcp (inbound) | Serve the console UI to users via the existing reverse proxy |

## B. Required for full monitoring coverage

| # | From | To | Port | Purpose |
|---|------|----|------|---------|
| 3 | 172.31.38.152 | OSB/UIL MySQL — host TBD (candidates 172.31.43.72 / VIP 172.16.1.115) | 3306/tcp | Read `logs.uil_logs` — BSS read-fault (1500/OSB-382000) monitoring; confirm host with OSB team (Debasis) |
| 4 | 172.31.38.152 | 172.31.43.9, 172.31.43.10 | 8443/tcp | API-Gateway health probe (TCP connect only) |
| 5 | 172.31.38.152 | 172.31.43.61 | 3000/tcp | APIGW DMS-entry health probe |
| 6 | 172.31.38.152 | servicehub.salam.sa (+ internal DNS resolution for *.salam.sa) | 443/tcp | ServiceNow read-only Table API — CST ticket correlation |
| 7 | 172.31.38.152 | internal SMTP relay (confirm host; HLD lists 172.16.1.115) | 25/tcp | Email notifications + OTP login mail |

## C. Optional (probe shows red today from console segment too)

| # | From | To | Port | Purpose |
|---|------|----|------|---------|
| 8 | 172.31.38.152 | 172.31.42.23, 172.31.42.24 | 8443/tcp | Remaining APIGW pair (visibility only) |
| 9 | 172.31.38.152 | 172.31.45.1 | 443/tcp | LB VIP (visibility only) |

## D. NOT a SOC ticket — no internet on 152 by design
These console features call **external** SaaS and will be disabled on 152 unless an internal egress proxy is provided (separate decision, not a firewall rule): WhatsApp alerts (graph.facebook.com), Teams/Slack webhooks, Tap reconciliation (api.tap.company), Unifonic SMS. Fallback channels that DO work: email (via internal SMTP), in-console alerts, ServiceNow correlation.
If an egress proxy exists, request instead: proxy access for graph.facebook.com:443, api.tap.company:443, webhook.office.com:443.

## Notes for SOC
- All probes are TCP-connect health checks or read-only SQL SELECTs; the app writes only to its own `mvno_console` DB (and replica tables if hosted on 121).
- No inbound connectivity needed except the proxy → 4600.
- Yusr chatbot LLM (Ollama) runs **locally on 152** (offline install) — no network flow, or if hosted on another internal box add: 152 → <ollama-host>:11434/tcp.
