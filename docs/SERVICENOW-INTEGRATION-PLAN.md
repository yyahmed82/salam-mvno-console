# ServiceNow (ServiceHub) integration — plan

Console: Salam Operations Console (`unified-console`, 152 · `/apps/unified`). ServiceNow: `https://servicehub.salam.sa`
(Service Operations Workspace). Status today: the console has a **read-only** correlation module
(`server/src/servicenow.js` — "related tickets" under an incident, Table API GET, basic auth from `SN_URL / SN_USER /
SN_PASS`) and the env template still says *BLOCKED until SOC ticket clears*. Nothing is written to ServiceNow yet.

## Decision: manual first, automate later

Yes — start manual. An L1 who has **acknowledged** an incident gets a **Send to ServiceNow** button; the console
pre-fills the INC, the person reviews and confirms, the INC number comes back on the incident. Reasons:

1. ITIL expects a human to confirm an alert is an incident before it enters the ITSM queue. The 8 Sep replica-lag
   artefacts (two false P1s, three anomalies) would all have become INCs under automation.
2. Every manual "send" is a labelled example (this rule + this severity → a real ticket). After 4–6 weeks the data
   says which rules deserve auto-ticketing and under which conditions, instead of guessing.
3. ITSM (MVNO-MS-ITSM) sees a controlled trickle of well-formed tickets first, so field mapping and categories are
   corrected on real cases before volume arrives.

Automation is then a per-rule flag plus conditions, not a new system.

## Status — 8 Sep 2026

- Network **152 → servicehub.salam.sa:443 is open** (`curl` → HTTP 401). Waiting for the integration account from ITSM.
- **Phase 1 + 1b are built** (`server/src/snTicket.js`, alerts view panel, Settings → Notifications → ServiceNow /
  Incident comms): raise INC after ack, INC chip + state poller, work notes, comms mail with preview. Ticket creation
  is a **dry run** until the account is in `.env` on 152 and *Ticket creation enabled* is ticked in Settings — the
  button shows the exact payload meanwhile, so the flow can be walked through today.
- To go live: `SN_USER` / `SN_PASS` in `/apps/unified/.env` on 152 → `pm2 delete salam-unified && pm2 start …` →
  Settings → Notifications → ServiceNow → *Test connection* → *List groups* (fix the Fixed group) → tick *Ticket
  creation enabled* on the **sub-prod** instance first (`SN_URL=https://servicehubdev…`), raise one test INC, then
  switch `SN_URL` back to production.

## Prerequisites (Phase 0 — nothing to build)

| # | Need | Who | How to verify |
|---|---|---|---|
| 1 | **Network** 152 → `servicehub.salam.sa:443` | SOC (the existing ticket) | on **152**: `curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 https://servicehub.salam.sa/api/now/table/incident?sysparm_limit=1` → `401` = reachable, timeout = still blocked |
| 2 | **Integration service account** (e.g. `svc_ops_console`), not a personal login. Roles: `itil` (create / update incident, add comments & work notes), `rest_api_explorer` optional; read on `sys_user`, `sys_user_group`, `sys_choice`. Basic auth over HTTPS is fine; if instance policy requires OAuth2 (client credentials) the module supports it with two more env vars | ITSM / ServiceNow admin | `curl -u user:pass ".../api/now/table/sys_user_group?sysparm_query=nameSTARTSWITHMVNO&sysparm_fields=name,sys_id"` lists the groups |
| 3 | **Sub-production instance** for testing (`servicehubdev` / `servicehubtest`?) with the same account | ITSM | same curl against the test host |
| 4 | **Field mapping sign-off** (below) — assignment groups per business, category/subcategory, impact × urgency (ServiceNow *derives* priority from impact + urgency; the API should set those two, not `priority`), caller, `correlation_id` for back-links | ITSM + Yosri | one page, agreed in a 30-min call |
| 5 | **Comms distribution lists** per business × priority (the To/Cc of today's "Critical Incident Notification" mail) and a standing Teams bridge link per business, or the rule that L1 pastes the bridge link at send time | Digital Ops | stored in Settings → Notifications |
| 6 | Who may send: a capability `ticket_servicenow` on roles; default = ack holders (`ack_mobile` / `ack_fixed`) and L1/L2 roles | Console | Settings → Users |

### Field mapping (proposal to agree with ITSM)

| ServiceNow field | Console value |
|---|---|
| `short_description` | `[Ops Console] <rule name>` (editable before send) |
| `description` | metric, operator/threshold, observed (n, window), fired at (KSA), team, channel/type for Fixed, runbook first steps, deep link `#alerts?id=N` / `#fixed-alerts?id=N` |
| `impact` / `urgency` | P1 → 1/1 · P2 → 2/2 · P3 → 3/3 (ServiceNow computes 1-Critical / 2-High / 3-Moderate) |
| `assignment_group` | per business: Mobile → `MVNO-MS-App-Digital-Chnls` (current `SN_GROUP`), Fixed → *to be named by ITSM*; overridable in the send form |
| `category` / `subcategory` | per rule (e.g. Payment / SADAD, Provisioning / Semati); default per business |
| `caller_id` | the ServiceNow user matching the sender's e-mail (lookup on `sys_user.email`), fallback the service account |
| `correlation_id` / `correlation_display` | `ops-console:<alert id>` / `Salam Ops Console` — dedupe + back-link |
| `work_notes` | "Created from the Salam Operations Console by <user> (acked <time>)" |

## Phases

**Phase 1 — manual create + read-back (≈ 1 week of build once Phase 0 items 1–4 are done)**
On an acknowledged incident (Mobile and Fixed views) the ack holder sees **Send to ServiceNow**. A panel shows the
pre-filled INC (short description, description, impact/urgency, assignment group, category) — edit, confirm →
`POST /api/now/table/incident`. The console stores `sn_number`, `sn_sys_id`, `sn_state`, `sn_synced_at` on the alert,
adds a system comment ("INC0022339 created by …"), audits `incident.servicenow.create`, and the incident row shows an
**INC chip** that deep-links to ServiceHub. A poller (every 3 min, outbound only — no inbound webhook needed, same
direction as today's read-only correlation) refreshes state / assigned-to / last update of every linked INC; the Health
self-check gains a "ServiceNow" line. Idempotent: one INC per alert; a second click re-opens the existing one.

**Phase 1b — comms mail from the console (same week)**
After the INC exists, a **Send incident comms** button renders the existing "Critical Incident Notification" template
(priority, ticket number, reported date/time, issue description, business impact Yes/No, impacted service, status
update, bridge link) pre-filled from the alert + INC; L1 edits status / bridge, confirms → sent to the configured lists
per business × priority (Bcc rule, the console's SMTP relay, From = the L1 monitoring address once the relay allows
it, else the console sender). Every send is logged on the incident; **Send update** re-uses the same template for
follow-ups (status change, resolved). This replaces the hand-written Outlook mail without changing its look.

**Phase 2 — two-way follow-up (1–2 weeks after Phase 1 is live)**
Console → ServiceNow: incident comments carry a **share to ServiceNow** toggle (posted as `comments` — customer
visible — or `work_notes`); ack / re-ack / hand-over / snooze / resolve are mirrored as work notes; console *Resolve*
can set the INC to Resolved with the close notes (optional, per role). ServiceNow → console: the poller pulls new
journal entries (`sys_journal_field`) for linked INCs into the incident discussion, tagged "ServiceNow · <author>", and
state changes (In Progress / On Hold / Resolved / Closed) update the chip; a Closed INC on a still-open alert raises a
reminder in Home › My incidents. Problem records linked to the INC (like PRB0040879 ← INC0022339) are shown read-only.

**Phase 3 — automation (after 4–6 weeks of Phase 1 data)**
Per-rule settings: `auto_ticket` on/off, minimum severity, "only if still unacked after N minutes", "not while the
source is stale" (the anomaly stale gate), and a per-business daily cap. Auto-created INCs use the same builder,
caller = service account, work note "auto-created". P1 auto-creation also auto-sends the comms mail with a standing
bridge link. A global kill-switch in Settings and a metric (`tickets created / alerts fired`, manual vs auto, tickets
closed as "not an incident") keep it honest. Rules whose manual send-rate was low stay manual.

## Notes

- Keep the read-only correlation ("related tickets") — it becomes "related + linked".
- Secrets stay in `/apps/unified/.env` on **152** (`SN_URL / SN_USER / SN_PASS`, later `SN_GROUP_FIXED`,
  `SN_OAUTH_CLIENT_ID / _SECRET` if needed); nothing in the DB or the UI.
- Rate limits: ServiceNow Table API is generous, but the poller must batch (`sys_idIN…`) — one call per cycle, not
  one per incident.
- Schema (DB `unified_console` on **121**): `ALTER TABLE alerts ADD COLUMN sn_number text, sn_sys_id text, sn_state text,
  sn_synced_at timestamptz;` plus `incident_comms(id, alert_id, kind, sent_to, sent_by, sent_at, body)` — added to
  `schema.sql` (idempotent) when Phase 1 is built.
