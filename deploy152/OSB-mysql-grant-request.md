# Request: read-only MySQL account on the OSB integration log (logs.uil_logs)

**For:** OSB / BSS DBA team · **Requested by:** Digital & MVNO Operations (Yosri Yahmed)
**Purpose:** automated detection of BSS read-path SOAP faults (1500 / OSB-382000) in the Digital Console

---

## Good news first — no firewall change is needed

A connection attempt from the console server reached the MySQL server and was answered:

```
Access denied for user 'console_app'@'ruh-salam-site03.itc.local' (using password: YES)
```

That error comes from **MySQL itself**, not from the network. So TCP **172.31.38.152 → 172.31.43.72:3306
is already open** and no SOC/firewall ticket is required. The only thing missing is a database grant.

## What we need

A **read-only** account on the OSB integration log, usable from the console host:

| | |
|---|---|
| Database | `logs` |
| Table | `uil_logs` (read only — no other table required) |
| Client host | `172.31.38.152` (`ruh-salam-site03.itc.local`) |
| Suggested user | `console_ro` — **not** `console_app`, which is our PostgreSQL user and was reused here by mistake |
| Privilege | `SELECT` only |

```sql
CREATE USER 'console_ro'@'172.31.38.152' IDENTIFIED BY '<password>';
GRANT SELECT ON logs.uil_logs TO 'console_ro'@'172.31.38.152';
FLUSH PRIVILEGES;
```

**Password constraint:** please use **letters and digits only**. Characters `@ : / # ?` break
connection-URL parsing and are a recurring source of silent auth failures.

## What the console will run

Read-only aggregates over a rolling window, roughly once every 5 minutes. No writes, no schema access,
no joins to other tables:

```sql
SELECT count(*) FROM uil_logs
 WHERE (response_code = '1500' OR response_message LIKE '%OSB-382000%')
   AND insert_date_time >= (NOW() - INTERVAL 10 MINUTE);
```

Plus a per-minute count and a top-20 by `api_name` over the same window. If the column names differ
from the above, tell us and we will configure ours to match — they are settable via environment
(`OSB_LOG_TABLE`, `OSB_LOG_TIME_COL`, `OSB_LOG_CODE_COL`, `OSB_LOG_MSG_COL`, `OSB_LOG_API_COL`).

An index on `insert_date_time` would keep these cheap. If none exists, we will widen the polling
interval rather than ask you to add one during business hours.

## Why it matters

On **06 Aug 2026**, P1 **INC0016809** ran for over an hour before anyone correlated it. The console
now detects the BSS **write-path** 1500s (`createSubscriptionTransaction`) from our own replica.
The **read-path** faults — `list-invoices`, `get-account`, `get-sub` — are only recorded in
`logs.uil_logs`, so they remain invisible to us. Those are the ones customers experience as
"plan details won't load", greyed-out balance transfer, and general slowness.

With this grant, the console detects them automatically and raises the incident with the failing API
named, instead of waiting for a customer report.

## In the meantime

We have unset the connection on our side so the console reports the read-path as **unmonitored**
rather than appearing to watch something it cannot see, and so the failed-login attempts stop.
