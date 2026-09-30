## 2.0.0-alpha.132 — 2026-10-01

- DMS ▸ Explore: three scopes — **Dealer app** (21 journeys, 17 Sep code), **Admin & CMS** (24 back-office journeys: CMS users & rights, dealer administration, session resets, devices/QR, channels & hierarchy, documents, commission config, SIM/device inventory, wallet refill approval, bulk disbursement, self-activation hooks, Salam BI decrypt, plan catalogue, auth policy, app-content config, Semati config, notifications, tickets, reports, audit query API) and **System & batch** (12: audit pipeline, the 16 `@Scheduled` jobs grouped, regulatory suspension, the Semati / Nafath / SADAD / HyperPay callbacks). Each admin journey states explicitly which actions leave **no audit row** (channel, reports, doc-management, wallet, consumer and UIL-registry services have no producer). 26 candidate rules A1–A26 listed per family (not wired). Source: `server/src/dmsAdminJourneys.js`, merged into `/api/dms/journeys/spec`; doc `DMS-CODE-G-ADMIN.md`.
- Explore › **DMS API reference** (`#dmsdocs`): every endpoint of the 14 DMS services (631 endpoints, 94 controllers) from the decompiled 30 Sep 2026 production JARs — verb, full path (context-path resolved), caller (app / cms / internal / portal / partner / callback), request DTO fields with `required` from the validation annotations, response codes as set in the code, downstream calls in order, tables & ledger rows written, Feign callers, notes. Filters by service, caller, journey (`#dmsdocs?j=<journey>` — linked from every Explore card), full-text search; the 13 Feign clients that target a path no controller serves are listed. Data `dmsApiDocs.json` (rebuilt per release from the dms-source repo); docs `DMS-FEATURE-DATAFLOW-MAP.md`, `DMS-API-REFERENCE.md`.
- Explore › **DMS journeys** (`#dms-journeys`): the DMS flows walked step by step like Mobile › Journeys — actor / family filters over the 57 journeys (dealer app, admin & CMS, system & batch), Success path / Failure mode, Prev / Next / Play, and per step a sequence diagram (DMS app or CMS portal → owning service → every downstream call in code order → ledger push), "Calls this step makes" (controller#method, impl, downstream, tables written), "On success" (the ledger rows of the journey signature, the 00 code) or "Failure modes" (the codes the endpoint answers, its break points), and the journey-level signature / break points under the steps. Clicking an endpoint opens its API-reference card (request fields with required flags, codes, downstream, writes, notes). Deep link `#dms-journeys?j=<key>&s=<n>`; every DMS ▸ Explore card has "Step by step ▸".
- DMS journeys board: the trace box wiring no longer throws when the box is re-rendered.

## 2.0.0-alpha.131 — 1 Oct 2026 — DMS release diff (what the vendor changed, from the jars alone) + agent DB pools

- `deploy152/jar-release-diff.sh` (shipped to `/apps/unified/server/`, CFR 0.152 in `server/tools/cfr.jar`): compares two DMS jars — or two snapshot directories, services paired by name — exactly at bytecode level (class hashes → changed / added / removed), lists library upgrades and configuration / resource diffs with secrets masked, then decompiles only the classes that differ and writes `REPORT.md` (per class: lines, methods touched), `changes.diff` and `src/old` / `src/new`. `--fetch <host…>` pulls the live jars from the APP nodes over the console_ro SSH identity into `/apps/unified/snapshots/<date>/`. Read-only on the DMS side.
- DB connection footprint on 121 (the "Console DB — console connections 28" WARN after the 30 Sep reboot, uncommitted until now): the two AI-agent processes load `db.js` and each opened the console's full pools (source 8 + console 4 + ops 3). Agents now run with `SOURCE_POOL_MAX 2`, `CONSOLE_POOL_MAX 2`, `OPS_POOL_MAX 1` (ecosystem `agentEnv`, overridable with `AGENT_*_POOL_MAX`) tagged `salam_unified_agent`; `source` / `console` pools drop idle connections after 30 s; the healthcheck budget counts the agents' pools.

## 2.0.0-alpha.130 — 2026-10-01

- Infrastructure alerts · info-only mode (default ON): the `infra_*` / `fixed_infra_*` incidents keep the whole console flow — fire, sections, guide, ack, resolve, hosts behind the number — but the outbound side is switchable per channel in Console Settings › Notifications & escalation › Infrastructure alerts: mail on fire, Teams / Slack / WhatsApp on open, ACK-SLA reminders (and the red beyond-SLA banner), escalation ladder. All off by default so L1 is not paged while the hosts are still being wired; a note shows on the infra alert pages. Setting `infra_alerts`, audited, `/api/settings/infra-alerts`.

## 2.0.0-alpha.129 — 2026-10-01

- Infrastructure › Alerts: the infrastructure incidents move to their own two sections — **Mobile infra** (`#infra-alerts`, rules `infra_*`) and **Fixed infra** (`#fixed-infra-alerts`, rules `fixed_infra_*`) — the full incident view (guide, ack, resolve, hosts behind the number, history, rules & thresholds, noise, on-call) scoped to infrastructure, with a Section switch on the page and two entries in Infrastructure ▾. Mobile › Alerts and Fixed › Alerts no longer list the infra rules (API `scope=app` / `scope=infra`; mails, digests and agents unchanged). The Alerts tab of the Infrastructure page links to both sections.

## 2.0.0-alpha.128 — 2026-10-01

- Navigation: **Infrastructure ▾** is a dropdown group like Mobile ▾ and Fixed ▾ — LIVE MAP (Mobile map · Fixed map), HOSTS (All · Mobile · Fixed), OPERATE (Infra alerts · Changes · Sources & coverage). The current page shows as the green chip on the button, deep links and back/forward keep the right item active, the phone drawer gets the same sections. Same role gate as before (view `noc`).

## 2.0.0-alpha.127 — 2026-10-01

- Infrastructure › Map: the zoom is fixed at the root — the diagrams carried a `viewBox`, so screen pixels were not user units and every zoom-around-cursor and Fit drifted (tiny diagram on narrow frames). Pixels are the units now; **Fit** uses the real extent of the drawing and fills the frame on desktop, iPad and phone; wheel and pinch zoom stay under the cursor; drag pans; double-click, key 0 and Fit re-fit; keys + / −; a zoom % badge. Export SVG writes a clean full-extent file.
- Infrastructure › Map: CPU / RAM / disk are now readable — a live strip under every card bound to hosts ("● OK · CPU 12 % · MEM 41 % · DISK 63 % · 2 hosts", or "ports only · no ssh yet", or "UNREACHABLE · 2 ports down"), coloured by threshold; hover it for each host's IP and figures, click the card for the host page. Replaces the 14-px mini-bars nobody could read. Both diagrams (MVNO, Fixed); phone hides the edge legend and export buttons inside the frame.

## 2.0.0-alpha.126 — 2026-09-30

- Alerts · infrastructure: the incident row itself names the impacted servers ("impacted: label ip (port 3306), … +n more") — the infra metrics write the hosts behind the number into the alert message, so the list, the mail and the agent triage carry the IPs; the incident drawer opens with the host table (IP · CPU · RAM · disk · load · ports · failing probes) first, before team and timeline.

## 2.0.0-alpha.125 — 2026-09-30

- Alerts: infrastructure incidents (`infra_*` and `fixed_infra_*`) now carry the hosts behind the number in the incident drawer › Evidence and in the notification mail — per host: label, IP, hostname, OS, role, the failing probes with their thresholds (unreachable / port closed / disk / memory / load), CPU % and count with the model, RAM used / total in GB, worst filesystem with used / size, load15 per core, ports down, connections, since / last seen / up since, and a link to the host page. Same predicates as the cases export, both segments.

## 2.0.0-alpha.124 — 2026-09-30

- Infrastructure: passerelle hop now uses an explicit `ProxyCommand` carrying the console key, port and BatchMode; `-J` did not pass `-i` to the jump host, so any host behind a passerelle prompted for a password and timed out.

## 2.0.0-alpha.123 — 30 Sep 2026 — Infrastructure: hosts behind a passerelle (ProxyJump), per-host ssh user, "Add host" bound to a card, service ports learned from the host, a closed guessed port is WARN not CRIT (full deploy)

- **Passerelle**: a host can carry `ssh_via` (`ip` or `user@ip`) — the console then connects with `-J` through it, the way the DMS logs were read through .17 / .18. Set on the host page ("Via passerelle") or when adding a host. The console key must open the passerelle too.
- **Per-host ssh user** (`ssh_user`) when a server does not have the default `console_ro`.
- **Add host** (Hosts tab, manageSync): IP, label, segment, role, ports, ssh, passerelle, and the diagram card it belongs to — the card then counts it in its status, bars and edges (e.g. the DIGAPI nodes .17 / .18 behind the "MVNO API Gateway" card, the UPG servers .35 / .36 / .37 behind "App / API Env").
- **Learned ports**: once a host answers by ssh, its service ports are replaced by what it really listens on (known service ports, or 3000–9999 app ports), recorded as a `ports` change; a person's edit wins afterwards.
- **Probe severity**: a closed port on a host that ssh does reach is WARN with the explanation, CRIT only when nothing reaches an edge / db host — the CRIT count now means "really down", not "wrong guess from the card".

## 2.0.0-alpha.122 — 30 Sep 2026 — Infrastructure hotfix: the HLD files are read from STATIC_DIR (/apps/unified/web) — on 152 the seed found 0 nodes; node exporter / Instana over http.get instead of fetch (server deploy)

- On 152 the web files live in `/apps/unified/web`, not two levels above `server/src`: `readNodes()` opened a path that does not exist, logged nothing, and the seed created only the console box. Now `STATIC_DIR` (the app already uses it), then `../../web`, then `../..`; a missing file is logged with its path.
- `fetch` + `AbortController` replaced by `http.get` with a socket timeout for the node-exporter scrape and the Instana calls (Node 18 on 152; undici aborts have crashed processes before — nothing in this module may take the app down).

## 2.0.0-alpha.121 — 30 Sep 2026 — Infrastructure: SSH discovery — every host the console key already opens is found and flagged by itself (full deploy)

- 152 already reaches every server with the log-collector key. Instead of flagging 40 hosts by hand, `discover()` tries `ssh … echo ok` (9 s, 8 at a time, read-only) on every enabled host not yet flagged, flags the ones that answer, logs a `discover` change per host, and the same inventory cycle reads them. Runs with every inventory cycle (daily) and on demand: **Discover SSH access** button in the section header (`POST /api/infra/discover`, manageSync); the toast names the hosts that refused.
- Instana stays optional (licence not available today); with ssh on every host the map edges, inventory and metrics are complete without it.

## 2.0.0-alpha.120 — 30 Sep 2026 — INFRASTRUCTURE section (CIO requirement): every server of the two HLDs, physical inventory, per-host health report, infra alerts Mobile / Fixed, the live map (full deploy)

- **Why**: the CIO asked for one place with every server / node — resources, CPUs, RAM, disks, NICs — the same healthcheck report per server, infrastructure alerts separated Mobile / Fixed, and the architecture diagrams made live with connectivity and traffic. Plan: `claude/INFRASTRUCTURE-SECTION-PLAN.md`.
- **No new agent.** `server/src/infra.js` probes from the console box, read-only, from four optional sources: *local* (this box), *ssh* (the read-only key the log collectors already use — `INFRA_SSH_USER/KEY` falling back to `API_LOG_USER/KEY`; hosts flagged ssh: `API_LOG_HOSTS`, `FIXED_LOG_HOSTS`, `INFRA_SSH_HOSTS`, or the flag on the host page), *service ports* (TCP connect to the ports printed on the card — reachability with no access at all), *node exporter* (:9100, auto-detected), *Instana* REST (`INSTANA_URL` + `INSTANA_TOKEN`: host inventory for every agent-monitored host, plus hosts the diagrams do not know). Every tick (60 s, six hosts at a time, 10 s each): metrics (cpu, load, memory as MemTotal − MemAvailable, swap, every mount, NIC bytes/s, established connections per peer from `ss`), then the probes → status. Inventory daily or on demand: lscpu, meminfo, lsblk, df, ip, boot time, listening ports, systemd units, pm2 apps, agents present, NTP. Nothing is written on any host; no sudo.
- **Seeded from the diagrams themselves**: the hosts (42) and the map bindings (52 cards) come from the card ids, labels and the IPs printed on `mvno-rodod-hld.html` and `fixed-diagrams/salam-fixed-digital-bss-hld.html` (ranges and `.81/.82` shorthands expanded; retired Optiva hosts seeded disabled); role and service ports inferred from the card, editable on the host page (segment, role, ports, IPs, owner, ssh flag, enabled, notes — audited). Tables `infra_hosts · infra_host_changes · infra_host_metrics (30 d) · infra_flows (7 d) · infra_map_nodes · infra_probes (30 d) · infra_runs`.
- **Section Infrastructure** (top-level nav, view `noc`): **Map** — the HLD embedded (`?embed=1`: diagram only) and painted every 30 s by postMessage: status dot per card (worst of its hosts; dashed red card = unreachable), cpu · mem · disk mini-bars, ↓↑ throughput, edges bright + animated where connections were observed between the hosts behind the two cards in the last 5 min, thin when quiet, dotted grey when not observable; particles only run on observed edges; "seen but unmapped" peers listed under the map; click a card → its host. **Hosts** — every host with status, cpu / mem / disk bars, network, inventory summary, sources, filters by segment / status / text. **Host** — the health report (the healthcheck mail, live: reachable, every service port, load per core, memory, swap, every disk, pm2 apps, Instana agent, NTP), the physical inventory, 24 h sparklines, connections out / in, the change log, the settings form. **Alerts** — the open infra alerts. **Changes** — inventory drift, reboots, listeners that appeared / disappeared, status flips, edits (30 d). **Sources** — the coverage matrix (which host is seen by what), how it works, thresholds, last runs.
- **Alerts, Mobile / Fixed separated**: metrics `infra_hosts_down · infra_ports_down · infra_hosts_crit · infra_disk_pct_max · infra_mem_pct_max · infra_load_per_core_max` and their `fixed_infra_*` twins (Mobile + shared hosts vs Fixed hosts); rules per side: host unreachable (P1), service port down (P2), disk ≥ 90 % (P2), memory ≥ 95 % (P2), load per core ≥ 2.5 (P3), owners infra-l2 (Fixed) / mobile-digital-l2 (Mobile, until a Mobile infra responder is named), with descriptions and runbooks; "Affected cases" lists the hosts behind the number with their probes. A host with nothing to probe (no port, no ssh, no exporter, no Instana) is *unknown*, never CRIT — no false P1 on partner cards.
- **Mails**: `INFRA_HEALTH_EMAILS` gets a per-segment digest in the healthcheck shape on a change of the segment's level (at most every 6 h otherwise). Thresholds `INFRA_DISK_WARN/CRIT` (80/90) · `INFRA_MEM_WARN/CRIT` (85/95) · `INFRA_LOAD_WARN/CRIT` (1.5/2.5 per core) · `INFRA_SWAP_WARN` (50).
- Tested on the local console (seed from the two HLDs, probe run, map overlay on both diagrams, host page, settings, changes); dark + light + phone checked. Routes: `GET /api/infra/overview · /hosts/:id · /map?diagram= · /changes` · `PUT /hosts/:id` · `POST /hosts · /run · /seed · PUT /map/:diagram/:node` (manageSync for writes).

## 2.0.0-alpha.119 — 30 Sep 2026 — Refund exposure filters: the URL is the truth, a Reset button, live search (web-only deploy)

- **Stuck filter, stuck URL**: the page kept its filter state between visits and only *added* what the hash named — removing `q=` (or `kind=`, `batch=`…) from the URL changed nothing because `setHash()` wrote the remembered value straight back. Now a hash **with parameters is authoritative**: every filter it does not name returns to its default (search, kind, status Open, verdict, batch, register reason / missed / outside-policy). A bare `#refunds` (the navtab click) keeps the current state, as before.
- **Reset filters** button in the period bar: last 30 days, Open, no search, no kind, no verdict, no batch, register and history filters cleared, drawer closed, hash rewritten.
- **Live search**: typing 3+ characters looks the customer up after 450 ms (Enter still works); emptying the box returns to the period view at once; the "search ✕" chip appears next to the box as soon as a lookup is showing.

## 2.0.0-alpha.118 — 30 Sep 2026 — Refund exposure: a customer lookup that answers whatever the period or status (TKT-000071) and a refund-eligibility policy — recharges are never refund cases (TKT-000072) (full deploy)

- **TKT-000071 — why a number "had no records"**: the Exposure tab is a backlog view — the Open chip plus the period preset. A refund that lives in the proxycms register, a case already approved / refunded / dismissed, or a candidate older than the preset was invisible to the search box, while Customer 360 (which reads every status over 2 years) showed it; the "REFUND DUE" link then landed on that same filtered list. **Fix**: a search is now a **customer lookup** (`GET /api/refunds/lookup?q=`): the exposure table becomes the customer's refund file — every candidate of any status and any time (with the desk verdict, the batch, the register status), every proxycms refund of the number in 2 years, every payment of the last 365 days with its journey and eligibility. Deep links from Customer 360: the REFUND DUE pill and every line of "Refund exposure" open **that case** (`#refunds?q=<mobile>&id=<case>` → trace drawer); a *refunded* payment in the Payments tab carries "register ↗" (`&payment=<id>` → the proxycms refund drawer). "search ✕" returns to the period view. The search box says so: "Enter searches every period and every status".
- **TKT-000072 — refund eligibility is a policy, not a habit**: only four journeys can carry a refund — Onboarding (new line / port-in), Change plan, SIM / eSIM replacement, Data SIM — on transaction failure or change of mind. A **recharge is never a refund case**: the amount not reflected is a **balance adjustment raised to the BSS team**; a CST-approved exception still goes through proxycms and shows as *outside policy*, counted, never hidden. The policy is a setting (`refund_eligibility`, Detectors tab, manageSync) applied in four places: (1) the `duplicate_charge` detector only groups eligible payments (`payment_on_type` matched case-insensitively — 'Recharge' and 'recharge' both exist; a Checkout's journey is `checkouts.checkout_type`: 1 data SIM · 2 change plan · 3 SIM replacement; 0/4 store, 5 ownership, 6 renewal, 7 advanced postpaid are out); (2) a **policy sweep** every tick, BEFORE auto-resolution, dismisses open / approved candidates outside the policy with the path to follow (`updated_by = policy`, kept in History); (3) the **register** carries journey + eligibility per refund, an "outside policy" badge, a chip filter and a counter, and the Analysis totals show refunds outside policy per journey; (4) the **refund desk** (Agent 2) gives a deterministic *dismiss* with the path for such a candidate, no model call. Customer 360 payments and the lookup show, per payment, "eligible for refund: yes / no — path".
- Tested locally with a customer carrying a duplicate recharge (dismissed by the sweep with the BSS path, not "resolved by the platform"), a duplicate onboarding charge (still flagged) and a CST-approved recharge refund in proxycms (shown as outside policy); deep links verified; dark + phone checked.

## 2.0.0-alpha.117 — 29 Sep 2026 — Agent 2 learns and earns autonomy: review queue with suggested verdicts, implicit rating, rated notes in the prompt, promotion ladder (full deploy)

- **Why**: 281 triage notes were "awaiting feedback" and the 👍/👎 they waited for was stored and counted (Triage quality) but read by nothing — the next note of the same rule did not change. Rating by hand, one note at a time, taught the agent nothing and cost a person's afternoon.
- **Review tab** (Agents & LLM › Review, `agentLearn.js`): every unrated note next to how the incident actually ended — final team, who resolved it, reason, re-assignments — with a suggested verdict: *helpful* (closed by the team the note suggested, no re-assignment), *not helpful* (ended with another team / re-assigned away), *n/a* (cleared by itself, nobody touched it — leaves the queue, never counts), *undecided* (still open or no team on either side — a person decides). **Confirm all suggested verdicts** rates them in one click, audited under the reviewer (`feedback_source = review`). A note the model called noise that a person closed as a false positive is rated helpful.
- **Implicit rating from now on**: `/api/alerts/:id/resolve` and re-assign rate the note the same way (`feedback_source = implicit`); a person's own 👍/👎 (`human`) always wins. Counters on the tile and on Mission control show how many came from people and how many from the outcome.
- **Learning loop**: the triage prompt carries the last 2 helpful notes of the same rule (cause · action · team · how it was closed) and the last unhelpful one with the team that finally closed it; `agent_triage.noise` stores the model's is_noise so a false-positive close can be judged. The team mapper is told the teams a person rejected for a rule and never proposes them again (keywords or model).
- **Promotion ladder** (Agents & LLM › Policy & promotion): per rule over 30 days — notes, rated, helpful %, team match % on incidents people handled, duplicates confirmed / refused — and its level: *advise* → *assist · team* (the agent sets the owner team when the incident has none; ready at ≥ 10 rated, team match ≥ 90 %, helpful ≥ 70 %) → *assist · team + duplicates* (exact duplicates closed with a comment; ready at ≥ 10 confirmed duplicate calls, none refused). **Promote** / **Demote** buttons write the existing allow-lists (`agent_incident` policy) and a history row (`agent_rule_promotions`). Nothing is promoted by itself; a promoted rule whose helpful rate falls under 70 % on ≥ 10 ratings is **demoted automatically** on the next tick (audited as `agent`). Flow-guard rules are deterministic and always ready. Thresholds: `AGENT_LEARN_MIN_RATED`, `_TEAM_MATCH`, `_DUP_CONFIRMED`, `_DEMOTE_BELOW` in .env (defaults 10 / 0.9 / 10 / 0.7).
- Mission control: "triage notes to review" (links to the Review tab, 30-day window) and a new "rules ready to promote" line; the daily log intelligence mail gets an "Agent 2 learning" line. Routes: `GET /api/agents/review`, `POST /api/agents/review/confirm-all`, `GET /api/agents/scores`, `POST /api/agents/promote|demote` (root tier, same gate as the policy). Tested on the local console with a 17-incident fixture (verdicts, confirm-all, promote, implicit rating on resolve, auto-demote); dark + phone checked.

## 2.0.0-alpha.116 — 29 Sep 2026 — Data SIM activation health read from the data numbers (9668…), Semati refusal rule added (server deploy)

- The alpha.115 `datasim_activation_fail_rate` had an empty population: data SIMs are activated under the DATA NUMBER (msisdn 9668…) and never carry an onboarding_order_id (measured 29 Sep: 0 rows by order; by prefix in 7 days 175 BSS create-individual-subscriber calls, all OK, and 401 Semati new-mobile-number calls of which ≈ 60 % refused — 726 · 724 · 300 · 812). The metric now reads the BSS calls of 9668… numbers (Semati excluded, technical), and a new `datasim_semati_deny_rate` reads the regulator answer (business).
- Rules: `datasim_activation_fail` (P2, ≥ 30 % of BSS calls failed / 3 h, min 10 — baseline 0) and the new `datasim_semati_deny_spike` (P3, ≥ 85 % refused / 3 h, min 20 — the refusal floor is ≈ 60 % by nature, so only a near-total refusal means something changed). Affected cases updated; Journey health › Data SIM watches both. No web file changed.

## 2.0.0-alpha.115 — 29 Sep 2026 — Data SIM as a monitored journey (TKT-000069): three metrics, three rules on Mobile digital L2, a "Data SIM" pill in Journey health (server deploy)

- **Why** (TKT-000069, Sreekanth, 29 Sep): the Data SIM journey is on App screens flow (the documentation map, 24 journeys from the app code) but not on the Operational dashboard, whose Journey health strip only shows journeys backed by alert metrics (8 so far). Measured 29 Sep on the replica: 540–1,013 Data SIM orders a week (a group-11 number chosen at checkout), ≈ 20 % activated; `activation_logs` carries no `datasims` api, so activation health is read from the activation calls of those orders.
- **Metrics** (`metrics.js`): `datasim_orders` (orders created whose chosen number is group 11), `datasim_conversion` (activated / created), `datasim_activation_fail_rate` (state = false share of the activation calls of Data SIM orders). **Rules** (`seedRules.js`, owner `mobile-digital-l2`): `datasim_volume_drop` (P3, ≤ 25 orders / 24 h against 80–145 a day — the journey went quiet), `datasim_conversion_drop` (P3, ≤ 4 % / 24 h, min 40 orders), `datasim_activation_fail` (P2, ≥ 50 % failed / 3 h, min 10 calls) — each with the baseline, what it means and a runbook. **Affected cases** (`alertCases.js`) list the orders / activation calls behind each. **Journey health** (`api.js` JOURNEY_HEALTH): a "Data SIM" pill on the Operational dashboard, worst-of its three metrics.
- Tested on the local console (metrics, seed, case twins, `/api/journey-health`). Server deploy with restart; no web file changed.

## 2.0.0-alpha.114 — 29 Sep 2026 — Flow guard hotfix: a Data SIM plan is recognised by its name, never by plans.has_data_sim (2,331 false class mismatches purged)

- The first production run of alpha.113 flagged 2,331 activated "class mismatch" findings — a Regular number on a Solo plan is not a mismatch. Cause: `plans.has_data_sim` is `true` on almost every voice plan in production (it means "a data SIM can be added to this plan", not "this is a data plan"); the detector read it the other way. `isDataPlan` now matches the plan name only (Data SIM …, MBB …, J-MBB …), as the catalog does. `ensure()` deletes once the class-mismatch rows that alpha.113 produced for a non-group-11 number on a plan whose name is not Data SIM / MBB; the next scan re-detects the real ones over its 7-day window (the 180-day baseline for this kind was 0). No other change; server deploy with restart.

## 2.0.0-alpha.113 — 29 Sep 2026 — Onboarding flow guard (TKT-000068): vanity-on-prepaid, disabled-plan and class-mismatch detection, five rules owned by Mobile digital L2, Agent 2 triage from the finding, Agent 1 daily section, plan timeline, Customer 360 class badge (full deploy)

- **Why** (TKT-000068, Sreekanth, 27 Sep): "an alert for the onboardings placed with a non-business-approved flow — a vanity number with a prepaid plan, an onboarding with a disabled plan". Measured on the replica first (29 Sep, 180 days of chosen numbers): the vanity class is `numbers.group_id` (3 Regular · 4 Silver · 5 Gold · 6 Platinum · 7 Diamond · 11 Data SIM — the Apollo / BSS group ids; `price_type` is '1' on every row and means nothing); one order holds the numbers offered at checkout, the chosen one carries a `reservation_id` and a ≥ 30-day `expires_at`; `plans.plan_type` 1 = prepaid, 2 = postpaid; `plans.enabled` is the disabled flag. Silver on postpaid 182 orders, Gold 39, Platinum 12; Silver on prepaid 5 attempts — none activated (the purchase step refuses, number selection does not); Gold / Platinum on prepaid 0. Orders on plans disabled TODAY: thousands — but the Super Flex "Plus" series was live when they were placed, and Tamkeen / Freelancer / Visitor plans are sold through their own flow while hidden from the catalog, so "disabled plan" has to mean disabled AT ORDER TIME with an allow-list for dedicated-flow plans.
- **`server/src/flowGuard.js`** — every 15 min (55 s after boot; `FLOW_GUARD=0`, `FLOW_GUARD_INTERVAL_MIN`, `FLOW_GUARD_LOOKBACK_DAYS` 7, `FLOW_GUARD_BACKFILL_DAYS` 180 on the first run): one bounded query on the replica (chosen numbers of the window × orders × plans, by primary keys), three detectors — `vanity_prepaid` (group 4–7 with plan_type 1, vanity fee at stake from the Apollo catalog: Silver 500 · Gold 2,500 · Platinum 7,000 SAR), `plan_disabled` (plans.enabled = false AND the switch-off preceded the order — exact from the console's new **plan timeline** `plan_state_history` (every change of enabled / price / plan_type / name per plan, snapshot on every tick, before detection), approximated with `plans.updated_at` for plans first seen already disabled — the evidence names the source; allow-listed plans never counted: Tamkeen, Visitor, Freelancer, Martyr, FnF, Tygo, Hajj, SIMPAL, PE by name pattern, plus plan ids, editable on the page), `class_mismatch` (a Data SIM number on a voice plan or a voice number on a Data SIM / MBB plan). Findings in `flow_findings` (console DB): order id, checkout code, the number **masked to its last three digits**, class, plan, plan state, amount, activated / activated_at, reservation expiry, evidence — never a customer identifier. Status open → activated (a customer went through) · expired (the reservation lapsed, no impact) · resolved (with INC) · dismissed. Backfilled rows are dated by their order, so the first run never reads as "activated in the last 24 h" to the rules. `flow_guard_runs` keeps the runs.
- **Rules** (`seedRules.js`, owner `mobile-digital-l2`, class business, segment mvno): `onboarding_flow_vanity_prepaid` (P3, ≥ 1 activated / 24 h), `_attempts` (P4, ≥ 3 / 24 h), `onboarding_flow_plan_disabled` (P3, ≥ 1 activated / 24 h), `_attempts` (P4, ≥ 5 / 24 h), `onboarding_flow_class_mismatch` (P3, ≥ 1 / 24 h) — each with the full description (what counts, what does not, the baseline) and a five-step runbook. Metrics in `metrics.js` read `flow_findings`; **Affected cases** (`alertCases.js`) list the findings behind each incident (order, checkout, masked number, class, plan, SAR, INC, evidence).
- **Agents.** Agent 2 (`agentIncident.js`): for `onboarding_flow_*` rules the triage note is **deterministic — no model call** (the finding is the cause): cause with the example case, impact with the count and the SAR at stake, the first action, the cases, and the incident is assigned to the Mobile digital L2 team whatever the assist policy says (`rules:flow-guard` as the model label). Agent 1 (`agentLog.js`): the daily log-intelligence mail and its narrative carry an "Onboarding flow guard · 24 h" table (activated / new / open / without INC per kind, plan-catalog changes). Mission control (`agentsMission.js`): queue lines on both agents ("flow-guard cases activated, no INC", "flow-guard attempts open") linking to the page.
- **`flowguard.js` — Mobile › Flow guard** (`#flowguard`, view permission `errors`): tiles (activated needing an INC, activated in 24 h, open attempts, orders 7 / 30 d, vanity fees at stake, plan timeline since), the three kind cards with severity and the why, Findings (status chips, days, search by checkout / order / plan / INC / last three digits; the table becomes cards on phones) with a drawer (status, order, number and reservation, plan and its disabled-since, at stake, why it counts, what to do, evidence chips; Customer 360 by order id; Resolve with INC / Dismiss / Reopen, audited), Plan catalog (every plan: type, price, enabled / disabled / allow-listed, its timeline, its findings; filters), Detectors & settings (detectors, classes, schedule, rules, last 12 runs, the allow-list editor — manageSync). Green button system, dark mode through tokens, phone / iPad reviewed. Routes: `/api/flowguard/overview | findings | plans | :id/status | run | settings`.
- **Customer 360**: the identity card shows the chosen number's class (Silver · VANITY …, with the vanity fee and the reservation end) and a red "NON-APPROVED FLOW" flag linking to the finding; the reserved line in the services strip reads the class instead of the meaningless `price_type`. Lookup by the selected vanity number resolves the order as before.
- Fixture-tested on a local Postgres (eight cases: vanity on prepaid, vanity on postpaid, disabled before / after the order, allow-listed plan, both class mismatches, an unchosen 15-minute reservation) and end-to-end on the local console (sync → rule fires on `mobile-digital-l2` → Agent 2 note with the cases → Affected cases). Full deploy (server + web), restart.

## 2.0.0-alpha.112 — 27 Sep 2026 — Executive brief and product brief: "IT Operations" throughout, every slide reviewed against the latest remarks, layout fixes on the title and closing slides (web-only)

- **"IT Operations", never "Digital Operations"** (Yosri, 27 Sep): `exec-brief.html` — the title eyebrow ("Salam · IT Operations"), the title KPI caption (IT OPS · "owned in-house"), the timeline's first milestone, slide 12's first card, slide 13 ("Our IT Operations team…", "Led by Yosri A. Yahmed — IT Operations · programme lead"), slide 14 ("beside IT Operations"), the hidden B2B slide, the close ("IT Operations", "IT Operations · Live") and the brand line under every slide ("IT Operations · Observability Portal"); `product-brief.html` — the "IT Ops" team card; `exec-script.html` — every spoken line and cue.
- **Every slide re-read against the remarks** (team work led by Yosri, professional tone, nothing that reads as our own ways of working being slow): exec slide 3 "a measured number, with its cause" and "…live, with the evidence attached" (was "not an anecdote" / "not in a report next week"); slide 9 "every answer to CST is assembled from the evidence on record" (was "…rather than from memory"); the close's sponsorship pillar "the reference for the monthly and vendor reviews" (was "…instead of rebuilt in slides each month"). Product brief: "a measured number, with its cause"; the front-line slide "now the agent sees them as one, on one screen" / "one screen instead of two systems" (no unmeasured handling-time claim); "one shared record for both sides"; the Before column of "The added value" describes the old method without blaming anyone (found through calls and tickets · periodic reports, prepared by hand · separate logs on each side · context held by the rule's author · access spread across several tools · a second build, platform by platform · assembled from several systems) and closes "operations now sees first, and answers with the evidence"; "What we need" matches the executive ask (the GPU node, the AI team with Ahmad Shhadeh's support, alongside IT Operations).
- **Product brief figures brought to today**: 182 alert rules (was 177, six places), 67 on Mobile (was 62), 33 DMS flow rules (was 36 — the count in `dmsFlowRules.js`).
- **Layout** (checked at the presenting laptop's 1440×800 and at 1280×720 → 1920×1080, iPad, phone): the title slide's KPI tiles and the closing slide's KPI strip sat on top of the ‹ ▶ › controls — lifted clear; the closing strip also ran off the right edge (its `left:50% + translateX(-50%)` centring was cancelled by the reveal animation's `transform:none`) — now centred without a transform. Product brief: the teams slide (twelve cards) tightens below 860 px of height so the grid clears the controls; the closing pillars use line icons instead of emoji-style glyphs. Both decks: headlines balance their line breaks; overflowing content starts at the top (`justify-content: safe center`) and scrolls on tablets and phones; on phones 18 px gutters and a solid control pill instead of the colliding brand line and dots.
- **Product brief presenter mode**, as in the executive brief: `product-brief.html?present=1` opens paused, a click or → is the next slide, the hash keeps the slide (`#present-5`), a plain `#7` deep-links; links inside a slide no longer toggle autoplay.
- Web-only deploy, no restart.

## 2.0.0-alpha.111 — 27 Sep 2026 — Executive brief, final pass: the team built it (led by Yosri), each lever labelled under its figure, slide 8 "hours or days by hand — the console answers directly", slide 6 reworded (web-only)

- **Slide 13 · "What this proves"** (Yosri, 27 Sep): team work, led by Yosri — "That Salam can build it itself. Our Digital Operations team delivered it in-house — product, design, engineering, data, AI and operations — in ten months, alongside the day job, together with the L1/L2 and business teams who use it. No licence, no vendor, no external professional services." · "Led by Yosri A. Yahmed — Head of Digital Operations · programme lead — vision, architecture and delivery".
- **Slide 13 · the circled area**: the "Contractual ceiling" / "Ceiling" chips sat 10 px low because their class `.cap` collided with the deck-wide caption class (`.cap{margin-top:10px…}`) — renamed `.ceil`. The legend row next to "What it returns" is gone (it repeated the chips); each lever now carries its full label directly under its figure — Measured · Contractual ceiling · Avoided spend · Renewal target — a filled dot for money that is real today, a ring for a figure still to be realised (the dashed border is gone). Tile captions hide below 860 px of height so the slide fits a 1440×800 laptop screen; the source lines still hide below 800 px.
- **Slide 8**: "Hours or days by hand — the console answers directly." (was "…would have cost a week, answered the same day"); card labels "On the console — the arithmetic" / "Same screen — the real signal"; "By hand — hours to days" vs "With the console — directly" (orders per day and per channel, the funnel, the providers and the partners side by side on one screen; answered with its evidence, without pulling a team off delivery); closing line "…the answer was already on the screen — with the evidence attached."
- **Slide 6**, Before card: "Journey health was assessed only after a complaint — from individual observations, not an agreed measure." (was "…settled in the meeting that followed the complaint, by whoever had the better anecdote").
- Headlines use `text-wrap: balance` (no one-word last line).
- `exec-script.html`: slides 3, 6, 8 and 13 spoken lines and cues follow the new wording (no "a week later", no "one person"); the leave Q&A answers as a team's platform with the AI team and Ahmad Shhadeh's support; the close's launch cue aligned; live path → the Fixed web-channel page for slide 8, only if asked.
- Checked at 1440×801 (the presenting laptop), 1280×720, 1366×768, 1024×768, 1440×900, 1920×1080, iPad; notes page light / dark / phone. Web-only deploy, no restart.

## 2.0.0-alpha.110 — 27 Sep 2026 — Executive brief: the AI-team sponsor's name corrected to Ahmad Shhadeh (web-only)

- Slide 14 of `exec-brief.html` ("Who takes it to product level"), the speaker notes `exec-script.html` (section 14 and the close's "two — launch" cue) and the alpha.109 entry below now read **Ahmad Shhadeh** (Yosri, 27 Sep). No other change; web-only deploy, no restart.

## 2.0.0-alpha.109 — 27 Sep 2026 — Executive brief: slide 14 "the ask on one page" — endorse & enable (beta → official launch), sponsor the resources (hardware | software) (web-only)

- **Why** (Yosri, 27 Sep): before the close, one page the CIO can decide from — what we ask, what it costs, why it is worth it against the vendor contracts, who carries it — and the GPU-node request of 13 / 18 Sep raised officially.
- **Slide 14** (`exec-brief.html`, `.askp`), inserted before the close: "The ask · on one page" — *From beta to a Salam product — endorse it, and resource it.* — "a mandate, one GPU server and three access decisions". **Card 01 · Endorse & enable**: a four-step track Beta (live now: Mobile + Fixed, 182 rules, 26 roles, AI inside) → Endorse (today, pulsing) → Launch (cutover: one URL, the two legacy consoles retire — phase 6 of the convergence plan) → Run & enhance (continuous), and what enabling means: security review & pen-test before the launch, the monthly and vendor reviews on its numbers, an onboarding mandate (Call Centre, Finance, vendor teams), a named owner for the Fixed data feed. **Card 02 · Sponsor the resources — Hardware | Software**: the GPU inference node as requested (minimum L4 24 GB · 16 vCPU · 32 GB · 250 GB SSD; recommended L40S 48 GB · 32 · 64 GB · 500 GB), the status from the 18 Sep validation (asked 13 Sep for 27 Sep; 8 of 9 items open, no GPU assigned), ≈45–70k SAR once for an L40S server or ≈2–4k SAR / month rented in-Kingdom (indicative, `AI-VLLM-MOVE-PLAN.md`); 0 SAR in licences (vLLM, Qwen3, ALLaM — Apache-2.0; NVIDIA driver 550+ / CUDA 12.x; RHEL 9.4 / Python 3.11 on the VM's entitlement) and three access decisions (egress or an internal mirror, the ServiceNow API, SSO). **Band**: why it is worth it — < 2 days of L1/L2 fees buys the GPU server (≤70k SAR vs ≈38k SAR a day on slide 13's ≈1.16M-a-month baseline), one point of scope at each renewal ≈139k SAR a year pays for it in year one, incident triage 12 s → 2 s and 1 → 9 streams (projected, `AI-CPU-OPTIONS-AND-QUANT-2026-09-27.md`); who takes it to product level — the AI team with Ahmad Shhadeh's support, beside Digital Operations; the decision line.
- Inline SVG icon sprite (12 symbols), animated counters on the KPIs, a flow line on the track and a pulse on "today" (both off under `prefers-reduced-motion`). Fits 1280×720, 1366×768, 1024×768, 1440×900, 1920×1080 (type caps raised for 1080p projectors); iPad portrait fits without scrolling; phone scrolls.
- **Deck-wide, phone only (≤ 600 px)**: 18 px gutters; the brand line and the dots give way to the prev / play / next controls (they collided), which get a solid pill background.
- The deck is 15 visible slides (the B2B-market slide stays hidden); the close is slide 15.
- `exec-script.html`: 15 sections — new section 14 (2.5 min at 37:00; warnings: the status is the 18 Sep validation, costs indicative, triage projected, never add the comparison to slide 13's levers, the CPU-only / rental fallback), the close renumbered 15 at 39:30 with "two — launch" naming the GPU node, the three accesses and the AI team; run of play 41 min; live path → Mission control › Move to vLLM / GPU; a pre-room check of the GPU ticket; two Q&A (why a GPU at all; what exactly is blocking the node).
- Web-only deploy, no restart.

## 2.0.0-alpha.108 — 27 Sep 2026 — Executive brief: slide 13 carries the financial case (four levers, in SAR), the B2B-market slide is hidden (web-only)

- **Why** (Yosri, 27 Sep, for the CIO demo): the deck showed what the console cost and what it could become, never what it returns. The CIO has to see the money on one slide, with an honest label on every figure.
- **Slide 13 rebuilt** (`exec-brief.html`, `.s14.money`): the seven discipline cards become a one-line strip of seven tiles (2 → 1 platforms · 26 roles / 10 teams · 24 pages · 182 rules · Yusr + 2 agents · 21 Mobile / 4 Fixed · 32 integrations); under it **"What it returns · four levers, in SAR"** with a legend of four chips and four cards — **1 Revenue protected · Measured**: ≈142 k SAR already found leaking (131 k SAR duplicate Fixed bill payments in Q1, Finance's count of 492 payments; 10.7 k SAR Mobile app refunds May → Sep, 126 cases), a customer refunded before the complaint stays, ~1.5 M customers watched, B2B accounts next; **2 Penalty credits · Contractual ceiling**: 10 % cap on ≈1.16 M SAR / month of L1/L2 managed services (TCS Amendment 4 697,064 · Sigma 167-2024 run-rate 464,100) → up to ≈1.4 M SAR / year deducted from the invoice when a breach is proven and agreed, precedent SR 1.03 M applied to Wipro in 2022, Sigma 2025 self-reports 99.2–99.8 % with no credit claimed, candidates until Finance validates; **3 Internal product · Avoided spend**: 0 SAR licence per seat, the Call Centre as customer number one of the Salam B2B product instead of the tools it plans to buy, charged back per seat internally, adding a team is configuration; **4 Vendor scope · Renewal target**: both L1/L2 renewals due now, sized on what the console does (182 rules with the next step, 33 checks that were manual, agents reading logs every 15 min and drafting the triage every 3), every 10 % of scope ≈1.4 M SAR / year — a target for the negotiation, not a saving booked. Bottom band: "what this proves" unchanged; "the financial case, in one breath" + the ask (the console in the monthly vendor review and at the renewal table; a price list for the Call Centre this quarter). Every SAR figure is from the project docs (`VENDOR-CONTRACTS-REVIEW-2026-09.md`, `CONTRACT-REGISTER-IT-VENDORS.md`, `REFUND-CASES-REVIEW-2026-09-25.md`); the four numbers are different kinds and are never added up.
- **Slide 14 (the Salam B2B market) is hidden, not deleted**: the section carries the `hidden` attribute, the nav enumerates `.slide:not([hidden])`, so the deck is 14 slides, the dots and `#present-N` renumber, → from 13 lands on the close; remove the attribute to bring it back. Presenter mode unchanged.
- Fits 1280×720, 1366×768, 1024×768, 1440×900 and 1920×1080 without clipping (checked with headless Chromium); below 900 px wide or 600 px high the slide scrolls instead of clipping; footnotes hide and the lever headers wrap below 1300 px.
- `exec-script.html`: 14 sections, slide 13 notes rewritten around the four levers (4 min, "say *candidate* before he does", never add the four numbers into one ROI, no competitor name or price), the slide-14 section removed (its answers stay in the Q&A), the close renumbered 14 at 37:00, two new Q&A ("Is the 1.4 M real money?", "What does the Call Centre pay, then?"), run of play and live path updated (slide 13 → Vendors & contracts › Contracts only if he asks where the 1.16 M comes from).
- Web-only deploy, no restart: `/api/version` keeps reporting alpha.107 until the next full deploy (the build stamp is written by the full deploy only).

## 2.0.0-alpha.107 — 27 Sep 2026 — Recharge / bill-pay lookup: a rule for the step before the payment, a Customer 360 card with the IP-limiter verdict, and Yusr stops calling a lookup date "since"

- **Why**: the CIO typed his number on my.salammobile.sa › Recharge number and got "We detected an error! Make sure the information used is accurate." `validate_details` (selfcare-backend `Api::V1::RechargeController`) had failed before any payment row existed — invisible to `recharge_fail_spike`, which starts at `payments` — and the web page shows that one popup for every code: -704 IP-limiter block, -512 "account suspended" (any gateway/BSS failure on the profile read), -513 pending, -501 backend error on the postpaid due-amount path (`/bss/account/get-account-profile/v2` + `execute-account-blnc-query`), -112 unknown number. Source-level analysis in the project doc `RECHARGE-WEB-ERROR-CASE-2026-09-27.md`.
- **Metric `recharge_lookup_failures`** (`metrics.js`, console DB `api_error_events`): failures of `validate_details` / `validate_details_with_account` per window, IP-limiter blocks excluded (`app_ip_block_*` own them), the code as a dimension. A count, not a rate: the app logs failures only — one line in the app (log the successes of this endpoint) turns it into a rate, the collector already parses the file. **Rule `recharge_lookup_fail_spike`** (P3 → Digital Ops, business class, ≥ 12 in 1 h, PROVISIONAL): the runbook reads the code of the hour (-501 "Error 502" / -512 on healthy lines → the UIL account family or the profile read, check Monitoring › UIL / Digital-API for the same minutes; -513 → just-activated lines and the app's 10-min profile cache; -112 → typos) and names the two app defects to ticket (`find_account_manager` maps every exception to -512 and drops the cause; `total_bill_manager.rb` has no fallback).
- **Customer 360 › Logs & Diagnostics › "💳 Recharge / bill-pay attempts"** (`sub360.js`, `GET /api/subscriber/recharge-attempts`): the verdict first — *Blocked by the IP rate limiter — <ip>: n blocked attempts, first … last …, prior attempts, blocked now yes/no/unknown* with **Unblock this IP** for super admins (the existing audited `/api/monitoring/ip-unblock`); or *Postpaid due-amount path failing* from the console's own live-panel history of the account family; or the failed attempts from the customer's known IPs; or, for a customer with no app account (the CIO), *No IP on file* with a field to check an IP pasted from the customer's dialog or DevTools. Then the line (prepaid/postpaid, state, the path it takes), the attempts table (time KSA · code · what the customer met · prior tries · platform · IP), and the platform picture — last hour and 48 h by code, with "failing for everyone right now — not this customer's data" when the hour is over the rule's threshold. The per-customer half rides on `/api/monitoring/ip-search` (the app error log carries no customer identity); the new endpoint adds the paid type and state from the newest profile snapshot, the account-family snapshot history and the platform counts. Read-only, no BSS call, dark/light, phone.
- **"since" fixed** (`liveBss.js`, `assist.js`, `sub360.js`): a line found live in BSS carried `at = now`, which Customer 360 showed as its date and Yusr read as "since 2026-09-27" (an activation date that was really the lookup time). BSS-sourced lines now carry `seen_at` and no `at`; Yusr says "seen live on <date> — activation date not known here", the line chip's tooltip says "seen live"; the system prompt tells the assistant the difference.

## 2.0.0-alpha.106 — 27 Sep 2026 — One context size for every model call: no more model reloads between Yusr (4k) and the agents (8k)

- Found while verifying the Ollama unit (152, 01:22 KSA): `/api/ps` showed `llama3.1 · ctx 8192` right after the warm-up and `ctx 4096` two minutes later. Ollama keeps one runner per (model, num_ctx) — a call asking for a different size makes it **reload the 5 GB model**. Yusr, the incident triage, the rule-to-team mapping and the refund review asked for 4096; Agent 1's log assessment (every 15 min) and the connectivity probe asked for 8192; the empty-answer ladder's last rung asked for 8192 again — so the model was reloaded at least twice every 15 minutes, all day, on a CPU box (each reload = seconds of dead time for the caller, and the runner churn is the most plausible reason it grew to 13 GB).
- `server/src/llm.js`: `LLM_NUM_CTX` (default **8192**, the size the prompt budget was written for) is the context of **every** call; a per-call `numCtx` is only ever a minimum; the ladder's last rung asks for `max(LLM_NUM_CTX, …)` capped by `LLM_MAX_CTX`, so with the defaults it never reloads either. The per-call sizes were removed from `assist.js` (Yusr chat + warm-up), `agentIncident.js` (triage, mapping), `refundDesk.js` (review), `agentLog.js` (assess) and the probe. Verified against a fake Ollama: three callers → one `num_ctx` (8192), `keep_alive 30m` each.
- Keep the three in step: `LLM_NUM_CTX` (.env) = `OLLAMA_CONTEXT_LENGTH` in the ollama unit (`install-ollama.sh`, 8192) = the warm-up's `num_ctx`. `env.template` says so. Memory at 8192 with one slot: KV ≈ 1 GB → runner ≈ 5.8 GB (measured), the box at ≈ 60 %.

## 2.0.0-alpha.105 — 27 Sep 2026 — Healthcheck: a WARN probe joining a CRIT episode no longer mails; only a level change or a new CRIT probe does

- 01:17 KSA, five minutes after the first alpha.104 mail: "CRIT — Box memory 97% · CPU load 9.2" — the CPU load (a symptom of the same swapping box) crossed its WARN line and, being a change of the set of probes that are not OK, earned an immediate mail. On a box that is swapping the load flaps around the threshold all night. `prodHealth.js`: an edge is now the **overall level changing** (up, or down to OK) or a **probe becoming CRIT inside a CRIT episode** (an escalation); a WARN probe joining or leaving, or a CRIT probe clearing while another keeps the level, rides along in the next reminder — whose subject and attention list always carry the current picture. The state file keeps the CRIT set (`crit`); the mail's policy line says so. Verified in the sandbox: WARN joins → silent · second CRIT probe → mail "new CRIT probe" · clears while CRIT persists → silent · reminders 30 → 60 → 120 min unchanged.

## 2.0.0-alpha.104 — 27 Sep 2026 — Prod-safety healthcheck: memory measured as Linux sees it, the consumers named, no more flapping, reminders with backoff

- **Why**: 26 Sep — a whole day of `[Salam Ops] Healthcheck CRIT` mails from 152: "Box — memory 95 / 97 / 98 %" every 30 minutes while CRIT, plus a mail at every WARN ↔ CRIT flip around the 96 % line, and none of them said *what* was holding the memory.
- **Memory probe** (`server/src/prodHealth.js`): used % = **MemTotal − MemAvailable** from `/proc/meminfo` (the page cache is reclaimable and no longer counts as used; `os.freemem()` depends on the libuv build for which figure it returns). The detail now reads "98% used — 0.3 GB available of 15.3 GB · swap x of y in use" and, whenever memory is not OK, **the five largest processes by RSS** (read-only `ps`, labelled `node unified/agentLog.js`, `ollama` …) so the reader knows what to act on; the attention line carries the top three.
- **Hysteresis**: a % / count probe (memory, disk, CPU load, connections, shared-server saturation, Fixed ingest age) keeps its level on the way down until the value is `HC_HYST_PCT` (2) points below the threshold it crossed — 95 → 97 → 95 → 98 % is one episode, not four edges. Rising is always immediate. Every probe carries `value / warn / crit / hyst / short`.
- **Mail policy**: a change of the picture (overall level, or the set of probes that are not OK) always mails; a persisting CRIT is re-notified after `HC_CRIT_THROTTLE_MIN` (30) min, then the wait **doubles** — 30 · 60 · 120 · 240 — up to `HC_CRIT_MAX_MIN` (360); WARN after `HC_WARN_THROTTLE_MIN` (120) doubling up to `HC_WARN_MAX_MIN` (720); OK once as the recovery notice. A day of unchanged CRIT = 7 mails instead of 48. The subject names the worst probes and, on reminders, how long the episode has lasted (`Healthcheck CRIT — Box memory 98% · 6 h 20 min`); the mail shows "CRIT since", the reminder number and when the next mail is due. State file (`unified-healthcheck-state.json`) keeps level, signature, since, per-probe levels, last mail and reminder count; a failed edge mail is retried on the next run.
- **The consumer, found (27 Sep 01:12 KSA, first alpha.104 mail)**: `llama-server 12.6 GB` of 15.4 GB — Ollama's runner, running as a bare `nohup ollama serve` (the systemd unit was never active) with Ollama's own parallel-slot default and every console call asking for `num_ctx 8192`; 0.5 GB available, 2 GB in swap; every Node process of the console is 60–150 MB. `deploy152/install-ollama.sh` now installs the unit with `OLLAMA_NUM_PARALLEL=1` (one slot — the three CPU callers queue), `OLLAMA_MAX_LOADED_MODELS=1`, `OLLAMA_CONTEXT_LENGTH=8192`, `OLLAMA_KEEP_ALIVE=30m` and a cgroup ceiling `MemoryHigh=8G / MemoryMax=9G` (the kernel reclaims Ollama first and can kill only Ollama — never a production app), stops the nohup instance and its runner, warms the model at the console's `num_ctx` so the first real call does not reload it, and prints the tree's RSS and `free -m`; `deploy.sh` ships it to `/apps/unified/install-ollama.sh`. Expected footprint ≈ 6–7 GB (weights 4.9 + KV 1 × 8192 ctx ≈ 1 + buffers).
- **PM2 memory guard rails** (`deploy152/ecosystem.prod.config.js`, off until set in `.env`): `PM2_MAX_MEM` / `PM2_AGENT_MAX_MEM` → `max_memory_restart` (a leaking process restarts instead of pushing the shared box into the OOM killer), `NODE_HEAP_MB` / `AGENT_HEAP_MB` → `--max-old-space-size`. Values are decided from the healthcheck's "largest processes" line, not guessed. `env.template` documents the keys.

## 2.0.0-alpha.103 — 26 Sep 2026 — Teams management: the gear menu regrouped, AI Ops, and every user classified Salam team or contract (from the e-mail)

- **Gear menu** (Yosri, 26 Sep): three groups instead of one flat "Settings" — **Teams management** (User management · Responder teams · **Refund desks**, super admin), **Console settings** (sync engine, notifications & escalation, navigation & tabs, demo mode, tickets & feedback, audit log), **AI Ops** (Yusr, Mission control, Agents & LLM); NOC wall, IT governance and Regulatory affairs unchanged. Group keys are now `data-gkey` attributes (stable under the Arabic labels); the group of the current page opens itself (`#settings-users`, `#teams` → Teams management; `#agents-live` → AI Ops …). Every "Settings › Teams" mention in the console copy reads "Teams management › …".
- **Affiliation** — every console user is either **Salam team** or a **contract** resource, read from the e-mail address (`server/src/affiliation.js`, settings key `user_affiliation_rules`, first match wins): `.sns@` and `.dxc@` (and `@dxc.`) → Salam team (SNS / DXC resources work as Salam staff — Yosri's rule); `.tcs@` → TCS; `.sig@` / `.sigma@` → Sigma; `.orc@` / `.oracle@` → Oracle; `.ibm@` → IBM; `.evamp@` / `.es@` → Evamp & Saanga; `.subex@`, `.infosys@`, `.comviva@` → their vendor; a plain `@salam.sa` / `@salammobile.sa` → Salam; anything else → **unclassified** until a super admin assigns it or adds the rule. Contract resources link to the vendor of the contract registry (`affiliation_vendor`). Stored on `console_users` (`affiliation`, `affiliation_org`, `affiliation_vendor`, `affiliation_rule`, `affiliation_manual`, `affiliation_at`), applied at boot, on every rules change, on demand, and when a user is created; a row a super admin set by hand is never touched by the rules.
- User management: **Affiliation** column (🏢 Salam (SNS) · 📄 Sigma contract · ❔ unclassified, ✎ when set by hand), three KPI cards (Salam team with the SNS / DXC split, contract with the per-vendor split, unclassified), affiliation and per-organisation filter chips, the CSV gains Affiliation · Organisation · Vendor, bulk actions (→ Salam team, → each vendor, ↺ from the e-mail), and the **Affiliation rules** drawer (edit / reorder / add / remove rules, preview on all users before saving, save & apply, reset to the defaults, re-apply, the unclassified list with a jump to the user). The user drawer: AFFILIATION select — automatic (shows what the rule found), Salam team (plain / SNS / DXC), or a vendor's contract. Responder teams: the member picker and the members heading show the affiliation ("2 · 1 Salam · 1 TCS"); refund desk approver chips show it, and a contract resource named as approver is flagged (the approval is Salam's decision, the vendor executes).
- API (super admin): `GET /api/users/affiliation` (totals, per organisation, unclassified, rules, vendors) · `PUT /api/users/affiliation/rules {rules|reset}` · `POST /api/users/affiliation/apply` · `POST /api/users/affiliation/preview {rules, emails}` · `PATCH /api/users/:id {affiliation: auto | salam | salam:sns | contract:tcs}`; `GET /api/users` rows carry the columns. Audit: `users.affiliation.rules`, `users.affiliation.apply`, `user.affiliation`.
- **Executive brief and speaker notes** (26 Sep, for the CIO demo, web-only): `exec-brief.html` refreshed to alpha.103 — 182 rules (115 Fixed · 67 Mobile) on every slide, the six refund detectors on slide 4, ownership and the TCS / Sigma contract clocks on slide 5, slide 7 rebuilt as one assistant + two agents with "what it is allowed to decide: nothing", "Ownership is explicit" on slide 10, Finance on slide 12, the depth figures on slide 13 (462 endpoints, 70+ tables, 15 collectors, ≈80,000 lines); the MTTA / MTTR cards say *average* (the Alerts page computes a 30-day mean, not a median); **presenter mode** `exec-brief.html?present=1` — opens paused, a click or → is the next slide, ← back, F full screen, space toggles autoplay; the slide number is kept in the hash (`#present-5`) so a tab switch or a reload lands on the same slide, and a plain `#7` deep-links to a slide. `exec-script.html` rewritten for the demo: the pre-room checklist, the run of play with the 25-minute cut markers, the live path (which screen, when), 15 sections with the refreshed figures, the short Q&A. The review and the CIO questions are in the project docs (`EXEC-BRIEF-REVIEW-2026-09-26.md`, `CIO-QUESTIONS-EHAB-HAFEZ.md`).

## 2.0.0-alpha.102 — 26 Sep 2026 — REFUND DESKS in Responder teams: who handles refunds, strict recipients, internal P4 ticket, the two SLA clocks

- **Why**: batch #1 (alpha.100) went out through the approver fallback chain — no approver was set, so the desk fell back to the report audience, which includes the Fixed / Sigma people. Ownership of refunds now lives in **Settings › Teams › Refund desks** (`#teams?section=refunds`, super admin), one desk per business — **Mobile · proxycms** (live) and **Fixed · Moyasar** (defined now, its detectors arrive with the Fixed refund radar) — settings key `refund_desks`; the Mobile desk inherits the alpha.100/101 policy (`agent_refund`) until it is saved once. Per desk: the **executing team** (a registry team of that business; posts the refund in the gateway back office, gets the digest of new cases, is Cc of the approval request, owns the batch ticket), the **approvers** (the ONLY To of the approval request — picked from the console users or typed; no fallback: with no approver nothing is sent, the page and the desk say so, `assist` mode cannot be enabled), the **copy list**, the **internal ticket** (severity per desk, default **P4**, ChatOps off by default), the two **SLA clocks** (a decision within 24 h of the request; the refund posted within 48 h of the approval — both editable), the agent's mode / batch hour / digest / confidence floor, a note. Every address is checked against `console_users`: a person of the other business is dropped and shown in red (approvers, copy, and team members alike); `postdeploy-check.cjs` section 5c reports it.
- **Recipients are explicit**: the approval request is a workflow mail — **To** the approvers, **Cc** the executing team + the copy list (`notify.sendHtml(…, {cc})`; never the bulk Bcc path); the digest goes to the team's members of that business and its DL; the mail footer states who was addressed. `refund_batches.mailed` records To / Cc / the dropped addresses.
- **The ticket per request is internal**: `refund_batch` (Fixed later: `fixed_refund_batch`) opens at the desk's severity (P4) with `dim {internal:true, desk, approvers, sla}`, owned by the executing team; the message names the approvers and the two clocks. The acknowledgement SLA gains a **P4 ladder** (4 h · 12 h · 24 h, no repeat, no management mail — Settings › SLA, per business) instead of borrowing P3's.
- **SLA clocks measured on the cases**: `refund_candidates.decided_at / decided_by` = the first human decision (Approve / Refunded / Dismiss on the page; a reopen clears it; older decided rows backfilled from their last human update). Approval = request mailed → decision; execution = approval → the register shows the refund. `refundDesk.slaStatus`: waiting, overdue, oldest, 30-day attainment and medians; shown on the desk (tiles "Decision clock" / "Execution clock"), in Settings › Teams, and on every row (⏱ decision due in / overdue · late; ⏱ refund due in / overdue). Metrics `refund_sla_approval_overdue` / `refund_sla_execution_overdue` behind two seeded **P4** rules: `refund_approval_overdue` → `digital-l1` (the Salam side), `refund_execution_overdue` → `mobile-digital-l2` — one ticket each while a case is beyond its clock, cleared on their own.
- **Withdraw a request**: "withdraw" on an open request (Refund desk tab, ackErrors) releases its open / approved cases for the next request, marks the batch withdrawn and resolves its ticket with a comment — the way to undo batch #1's wrong audience without SQL.
- Refund desk tab: the policy editor is gone; a read-only **Who handles Mobile refunds** card (team, To, Cc, ticket, clocks, agent, the Fixed desk) with "edit ›" for super admins, server-side readiness warnings with a link to the fix, the send button disabled and the confirm dialog naming To / Cc; the "Review the queue now" button no longer sends the assist-mode batch as a side effect. `refund-flow.html` and Mission control say where the recipients come from.
- API: `GET /api/teams/refund-desks` · `PUT /api/teams/refund-desks/:business` (super admin, audited `refund.desk`) · `POST /api/refunds/desk/batch/:id/withdraw` (ackErrors, audited); `GET /api/refunds/desk` carries `desks`, `warnings`, `sla`, `rules`; `GET /api/refunds` rows carry `batch_at`, `decided_at`, `decided_by`. `PUT /api/refunds/desk/policy` still works and writes the Mobile desk.
- After deploying: open Settings › Teams › Refund desks, set the approvers of the Mobile desk (and a DL or members on TCS · Mobile Digital & BSS L2); until then no request leaves the console. Batch #1 / incident #15177: withdraw it from the Refund desk tab so its 20 cases go out again to the right people.

## 2.0.0-alpha.101 — 26 Sep 2026 — refund desk: people act, the agent helps (guardrails made explicit, advise by default)

- Decision (Yosri, 26 Sep): every action on a refund is a person's — the approval is a click on the page by name, the refund is posted by L2 in proxycms; the agent reviews, routes, informs and prepares. The desk's default mode is now **advise**: it reviews the candidates (a proposal: verdict · proxycms reason · cause · first action · confidence), routes them to the Mobile L2 team, mails the digest of new cases, and **prepares** the approval batch and its ticket — a person sends them with "Send the approval batch now". `assist` (opt-in) only adds the daily sending of that request; in no mode does the agent approve, refund, dismiss, write to proxycms, the gateway, production or the replica.
- The guardrails are stated on the Refund desk tab, in the drawer ("a proposal — the decision is yours, the refund is L2's in proxycms"), on the verdict chips ("Refund proposed" / "Dismiss proposed"), in the digest and batch mails ("nothing has been approved or refunded by the console"), on Mission control and in `refund-flow.html`; `GET /api/refunds/desk` returns them (`guardrails`). Code: the desk has no call to `setStatus`, no proxycms/gateway client; a case closes as *Refunded · proxycms* only from the register.

## 2.0.0-alpha.100 — 26 Sep 2026 — Agent 2 · REFUND DESK: the refund cycle worked by the agent (review · assign · notify · daily batch + incident · reconcile) + the old-vs-new dataflow

- **`server/src/refundDesk.js`** (runs inside `salam-agent-incident`, every `AGENT_REFUND_INTERVAL_MIN` = 15 min; policy in settings key `agent_refund`, editable on the page): every open refund candidate gets a **review** — deterministic first (the kind, the Semati code in the evidence, the courier state, the change-plan message, the proxycms ledger state, the customer's timeline, sibling cases), then ONE on-prem model call (JSON) → verdict **refund | wait | dismiss | investigate**, the proxycms **reason** (validated against the live `refund_reasons` list), root-cause category, cause, first action, what to tell the customer, confidence; stored in `refund_reviews` (👍 / 👎 feedback, retried when the model was unavailable). The case is **assigned** to the responder team of the desk (default `mobile-digital-l2`, TCS · Mobile Digital & BSS L2 — the same registry as incidents). Each tick that reviewed new cases mails ONE **digest** to the team (members + DL). Daily at `report_hour` KSA (09:00) in `assist` mode, or from the button: the **approval batch** — the table the L2 mail used to carry (ref · INC · amount · date · reason · proof/analysis · customer masked · payment id for proxycms), an XLSX attached, mailed to the approvers (policy, else the Salam Digital Ops L1 team, else the report audience) with the team in copy, recorded in `refund_batches` + `agent_reports`; and an **incident** `refund_batch` (P2 from 3,000 SAR / 10 cases, else P3) assigned to the team — ack SLA, reminders, ChatOps, the incident drawer, the history XLSX all apply. **Reconcile**: the batch closes and its incident resolves when every case is refunded (proxycms, via the radar's correlation) or dismissed; progress is posted on the incident.
- Page: 🤖 verdict chip on every row (verdict · reason · confidence · rules/model), team and batch chips, a verdict filter, `?batch=` deep link (cases of one batch), the **Refund desk** tab (queue, verdict counts, feedback, last run, "Review the queue now", "Send the approval batch now", the policy editor for manageSync users — mode, team, approvers, copy, batch hour, confidence floor, notifications — the batches with their incident and progress, the last runs, the readiness warnings: team without members / DL, no approver). Drawer: the review with 👍 / 👎 and "Review again". Header: **⇄ Old vs new** opens `refund-flow.html`.
- **`refund-flow.html`**: the dataflow of the refund cycle, old (mail-driven: customer → call centre → INC → L2 rebuilds the facts → approval mail thread → refund, 5–10 days, no register) vs new (replica → detectors → Agent 2 review → team → batch + incident → proxycms → reconciled → KPIs/RCA), swimlanes drawn from a spec, dark/light, print-friendly, plus the step-by-step and what-runs-where tables.
- Mission control: a fifth robot, **Refund desk** (Agent 2 · refunds) — runs narrated, queue (cases to review, ready for the batch), open batches for humans. Alerts list: `· 🤖 refund batch` chip on agent-opened tickets; evidence panel explains the batch ticket.
- API: `GET /api/refunds/desk` · `PUT /api/refunds/desk/policy` (manageSync) · `POST /api/refunds/desk/run` · `POST /api/refunds/desk/batch` · `POST /api/refunds/desk/review/:id` (ackErrors) · `POST /api/refunds/desk/review/:id/feedback`; `GET /api/refunds` rows carry `agent`, `team`, `batch_id`, filters `verdict`, `batch`. Env (optional): `AGENT_REFUND_ENABLED`, `AGENT_REFUND_INTERVAL_MIN`, `AGENT_REFUND_MAX_PER_TICK`, `AGENT_REFUND_MAX_MODEL_PER_TICK`.
- Before the desk can reach anyone: Settings › Teams › **TCS · Mobile Digital & BSS L2** needs members and/or the mail DL (MVNO-MS-Apps-L2), and the approver e-mails go in the desk policy — the page says so until it is done.

## 2.0.0-alpha.99 — 26 Sep 2026 — refund exposure: detectors made index-friendly, scan-in-progress visible, impact counted on admin-posted refunds

- First production run of alpha.98 showed the boot scan still running minutes after the restart (`/api/refunds/run` answered `{"ok":true}` = a tick in progress, and the last recorded run was the pre-restart one with the old errors). `paid_not_activated` joined payments to orders through an OR-ed condition (order id OR checkout code) — a nested loop over every order on the replica. It is now two index-friendly branches (`UNION ALL`: OnboardingOrder payments → orders by id; Checkout payments → checkout → orders by code), the checkout-code lookups lost their casts, and `indexSource.js` builds two more replica indexes at boot (`checkouts(checkout_id)`, `onboarding_orders(mnp_number)`, CONCURRENTLY, best-effort). The overview reports which of the eleven indexes the detectors lean on are present.
- `POST /api/refunds/run` answers `{running:true, since}` while a scan is in progress (the page says so and refreshes); the overview carries `running`, `running_since`, `process_started_at`, and the live pill flags a last run that predates the restart.
- Impact figures count **platform-caused refunds posted by an admin** (the ones that travel through the approval mails); auto-generated refunds (the app reversing a failed change plan by itself — 1,056 of the 1,241 refunds of the last 30 days) are shown apart (`impact.auto_n / auto_sar / auto_platform_n`), never as "missed". Register and exports mark them `auto-refund`.

## 2.0.0-alpha.98 — 26 Sep 2026 — REFUND EXPOSURE rebuilt: detectors fixed, proxycms register reconciled, period · RCA · exports

- **Root cause of "0 candidates while refund mails keep coming"**: none of the six detectors ever ran in production — every statement was bound with the same two parameters whether it used them or not (`bind message supplies 2 parameters, but prepared statement "" requires 0` ×5, `could not determine data type of parameter $1` ×1). Each detector now declares its own bind list; the SQL was also proven on a schema copy of selfcare (`db/schema.rb`) before shipping.
- **SIM / eSIM replacement** is detected where the app records it: `checkouts` of type 3 (`Checkout::REPLACEMENT_TYPE`) that are `paid` and not `completed` (48 h eSIM · 5 d physical), with the last `/semati/new-sim` answer (731 / 738 …), sim type, pickup / courier state as evidence — the three cases of the 26 Sep approval mail (INC0029427, INC0029577, INC0029866) are exactly this shape. Uuid joins are index-friendly (`CASE … ::uuid`), `delivery_requests.delivery_on_type` is checked.
- **The proxycms register is the truth**: prod-sync now copies `refunds` (payment_id, admin_user_id, refund_reason_id, status pending/success/fail, refund_type, notes = INC, fail_reason), `refund_reasons` and `admin_users` (e-mail and role only — hashes, tokens and IPs are skipped). Every tick correlates the open candidates: a refund with gateway status *success* (or a payment now *refunded*) closes the candidate as **Refunded · proxycms** with the reason, the admin and the INC parsed from the notes; pending / failed refunds are shown on the row; the reason text follows `Refund#handle_text_reason` ("Failed Change Plan", "Failed OnboardingOrder" for auto-generated rows).
- **Page rebuilt** (`#refunds?tab=&from=&to=&g=&kind=&q=&reason=`, deep links survive a reload): period bar (Today · 7 · 30 · 90 d · this / last month · year · custom from → to, KSA days) with day / week / month buckets; tiles (open now, detected in period, refunded in proxycms, **flagged before the refund %** with median lead time, **missed by detectors**, time to close, oldest); trend chart (candidates detected vs refunds posted, SAR line); five tabs — **Exposure** (kinds with detector health, open / approved / everything, table → cards on phone, Trace / Customer 360 / Approve / Refunded / Dismiss), **History** (what was done in the period: refunded by proxycms or here, approved, dismissed, resolved by the platform, medians), **proxycms register** (reason · category · gateway status · vendor · search filters; who refunded, INC / notes, paid-for, customer, the console's verdict per refund: flagged first + lead time / flagged later / MISSED / n/a; details drawer), **Analysis & RCA** (impact strip, root-cause donut and bars by category with owner, by reason, by vendor, by paid-for, who refunds, RCA card per category with top reasons · covering detectors · what to fix, the missed list), **Detectors** (health, last runs, how it works, configuration). Drawer above the sticky header, scrim, Esc closes; dark / light; phone and iPad reviewed.
- **Exports** (`/api/refunds/export?format=xlsx|pdf&from&to&g`, cap `export`, audited, masked unless the audited unmask): XLSX with Summary · Candidates · proxycms refunds · By reason · By category (RCA) · By period; PDF report (KPIs, root causes chart + table, reasons, per-period chart + table, open candidates, register).
- **Reason categories** (console classification of the proxycms reason names, `REASON_RULES`): activation / Semati, change plan (BSS), platform / CMS (= platform-caused, the ones the detectors must catch first), delivery / stock, customer decision, coverage, test; each with an owner and a "what to fix" line.
- Alerts: metric `refund_gateway_failed` (proxycms refunds that failed at the gateway in the window) and seeded business rule **Refund failed at the payment gateway (P3, ≥ 1 / 24 h)**.
- Router: `#refunds?…` query strings reach the page (the navtab click reset the hash to a bare `#refunds` before the opener ran). `postdeploy-check.cjs` gains section 5b: overview answers, detectors ran, each detector without error, register present.

## 2.0.0-alpha.97 — 25 Sep 2026 — REFUND EXPOSURE: owed money detected before the complaint (Mobile › Refund exposure)

- New `refundRadar.js`: six detectors on the replica every 15 min, 30-day window, one bounded statement each (45 s cap, a failing detector is reported on the page, never breaks the tick): **paid, never activated** (payment success · order not activated after 6 h / 7 d for port-in · no successful activation log — the Semati 727/738/blocked cases), **same number ported in twice** (two paid MNP orders on one ported number), **change plan charged then failed** (status 2 on a successful payment, no later success — "IAM TOKEN IS NOT AVAILABLE"), **SIM/eSIM replacement paid, not done** (48 h, no activation after), **paid, delivery failed** (courier failed state, order not activated, no later delivery), **charged twice** (same customer/amount/target within 30 min). Candidates land in console `refund_candidates` (unique per kind+key) with evidence (gateway ref, order state, selected number, last activation answer, ported number, courier state …); a candidate its detector stops returning closes itself (`resolved_auto`).
- Page **Mobile › Refund exposure** (`#refunds`, gated like Troubleshoot): tiles (open, SAR at stake, new 24 h, older than 7 d, oldest), one card per kind (click = filter, detector errors shown), 30-day trend, status chips, search (mobile / order / payment / INC), table with evidence chips, **Trace** drawer (the customer's Troubleshoot timeline next to the evidence), Customer 360, and the register the approval mails never had: **Approve / Refunded / Dismiss / Reopen with INC + note** (audited). Super admins open unmasked; others unmask with the capability. Dark mode, phone cards.
- Subscriber 360: red **💸 REFUND DUE · n · SAR** pill in the header (links to the page filtered on the customer) and a *Refund exposure* line in the identity card. Yusr: `identity.refund_exposure` in the context, a deterministic "💸 Refund exposure …" line right after the name, and a rule never to say no refund is due when a candidate is open.
- Alerts: metrics `refund_exposure_new` (per window, dim kind) and `refund_exposure_open_sar`; seeded business rules **Refund exposure rising (P2, ≥ 8 new / 24 h)** and **Refund backlog above 3,000 SAR (P3)**, with evidence populations (alertCases).
- Context: the review of 2,338 refund mails (project doc REFUND-CASES-REVIEW-2026-09-25) — 126 approved-by-mail cases, all of them events the platform had already recorded.

## 2.0.0-alpha.96 — 25 Sep 2026 — the customer's full name, always (Subscriber 360 · Yusr · Mobile and Fixed)

- **Mobile**: `identity.customer_name` = `onboarding_orders.customer_name`, else the checkout's `contact_name`, else the app account — shown first in the Subscriber 360 header and as *Full name* in Identity & order details.
- **Fixed**: the BSS `salamchecknid` answer's `custName` is now kept (`inventory.customer.name`, `customer.name`, `inventory_summary.customer_name`) and shown in the Fixed header. Masked as "First …" unless the viewer may unmask (super admins are unmasked on the page).
- **Yusr**: the name is the FIRST line of every customer answer, written deterministically by the console (not left to the model); the context also carries it (`customer.identity.customer_name`, `fixed_customer.customer_name`) and the rule is explicit — every customer answer starts with the full name, or says "name not on file"; the LLM-offline fallbacks print it too.

## 2.0.0-alpha.95 — 25 Sep 2026 — selected number found: public.numbers, now synced

- Root cause of the whole thread: the selected number is a row of prod `public.numbers` (`identifier`, `onboarding_order_id`, `reservation_id`, `expires_at`) and the replica is a partial copy — `numbers` was frozen at the seed, so a September order's number could not be there. `numbers` is now in `prodSync.DEFAULT_TABLES`; the lookup is one equality on `numbers.identifier → onboarding_order_id`.
- prod-sync: columns prod added after the seed are now created locally before the copy (the copy is the intersection of columns, so `numbers.onboarding_order_id` / `expires_at` would otherwise never arrive).

## 2.0.0-alpha.94 — 25 Sep 2026 — selected number: one direct checkout join

- `onboarding_orders.checkout_id` is the checkout CODE (`checkouts.checkout_id`), not `checkouts.id`. The selected-number fallback is now a single bounded join (checkouts of the last 60 days on `mobile_number` / `contact_number` → order), 8 s cap, no staged guessing.

## 2.0.0-alpha.93 — 25 Sep 2026 — selected-number stages bounded (90 days, one column per query) + anonymous-user stage

- alpha.92's checkout stage (two unindexed columns OR-ed, unbounded) hit its 4–5 s cap and returned nothing; `guests` turned out to have no link to the order. Stages are now bounded to the last 90 days (a selected number only matters before activation), one column per query, checkouts first (`mobile_number`, then `contact_number`) then the order's `AnonymousUser` (`mobile_number`, `fut_mobile_number`) through `orderable_id`. 4 s cap per query, own connection.

## 2.0.0-alpha.92 — 25 Sep 2026 — the selected number resolves (checkout / guest record), lookup kept fast

- Discovery (alpha.91 verify) showed where the pre-activation "Number" lives: `checkouts.mobile_number` / `contact_number` (order 2la3eioq → 966510392090) and `guests.mobile_number` (order u6pv42xi → 966510426040) — never on `onboarding_orders`. Troubleshoot / Subscriber 360 / Yusr now fall back to a STAGED lookup (`visitorKey.orderIdByNumber`: checkouts, then guests; one small equality per stage, 5 s cap, own connection) only when the direct order lookup misses. The identity card shows *Selected number (not yet activated)* with how it matched.
- Performance: the order lookup is the plain indexed `mobile_number` equality again — OR-ing `mnp_number` beside it (alpha.91) turned it into an 8.7 s sequential scan.

## 2.0.0-alpha.91 — 25 Sep 2026 — HOTFIX: alpha.90 order lookup timed out

- alpha.90 OR-ed every catalogue candidate for the selected number (activation_logs, eligibility_logs, users, checkouts, the `extra` json scan …) into the order lookup — that query hit the 60 s statement timeout on the replica, so MSISDN searches on Customer 360 / Troubleshoot were slow or empty. The lookup is back to contact number + `mnp_number` + a short CONFIRMED list (empty until the discovery run says where the number lives); the wide discovery is diagnostics-only (`visitorKey.findValue`, 4 s per probe on its own connection).

## 2.0.0-alpha.90 — 25 Sep 2026 — selected number: found in its real home (related rows), passport resolve fixed

- alpha.89 assumed the selected number sits in an `onboarding_orders` column; on the replica none exists (verified: the table has no msisdn/number/selected_number column at all). The lookup now discovers where the number really lives — child rows linked by `onboarding_order_id` / `checkout_id`, parent rows the order points at (`checkouts` …), the polymorphic `orderable` (e.g. a number-selection record), and the order's `extra` json (bounded to 180 days) — and ORs those into the order lookup of Troubleshoot and Subscriber 360 (`visitorKey.numberHomes()`, cached 1 h; falls back to the contact number if the catalogue read fails).
- Fix: `visitorKey.resolve` selected a non-existent `platform` column, so a passport typed on the order (CU1745123) came back with *no match* (`matched_by: null`) — it is `activated_platform`.
- **Subscriber 360 identity**: the identifier on the order is labelled by what it is — *NID* (1…), *Iqama* (2…) or *Passport* (anything else: A35659593, CU1745123, 146018237) — instead of "NID —" for a visitor; the visitor's nationality is shown next to it when the replica carries it (`identity.id_kind`, `identity.nationality`).
- **Subscriber 360 · super admins are unmasked by default**: no more "Unmask PII" click per search — the page opens unmasked for super admins (the button remains to mask again); other roles unchanged, and every unmasked read is still audited server-side.

## 2.0.0-alpha.89 — 25 Sep 2026 — search by the SELECTED number (order not yet activated)

- **The selected number** (the order's "Number" column — the MSISDN chosen before activation, while `mobile_number` is the contact number) is now a search key too: the column is discovered from the catalogue and OR-ed into the order lookup of the timeline and of Subscriber 360's lines. Before, a visitor order at the *payment* step (e.g. 966510426040 · CU1745123 · Visitor 52) was "No customer found" on both Customer 360 and Yusr.

## 2.0.0-alpha.88 — 25 Sep 2026 — visitors: search by passport or KSA border number (Subscriber 360 · Yusr · Troubleshoot)

- New `visitorKey.js`: classifies a pasted key (MSISDN · NID · iqama · KSA border number 3|4xxxxxxxxx · passport N01715453 / HE3486840I / 146018237) and resolves a passport or border number to the customer's onboarding order and MSISDN — equality on `onboarding_orders.nationality_id_number` (case-insensitive) first, then any border / passport column the identity tables carry on this replica, then one bounded text scan of the last 180 days of nafath / eligibility / activation answers.
- **Subscriber 360**: a passport or border number opens the visitor's profile like any subscriber; the identity card is labelled *VISITOR · passport / border no* with how the match was made. **Troubleshoot** timeline: the same resolution when the order is not found under the typed key. **Yusr**: understands "passport N01715453", "جواز سفر 146018237", "border number 3xxxxxxxxx" and bare passport tokens (ticket numbers INC/TKT are never taken as passports).
- Context: the Visitor 112 Nafath thread (INC0027164 / INC0029489) — two visitor customers not searchable by the only identifiers the front line had (passport, checkout code).

## 2.0.0-alpha.87 — 25 Sep 2026 — NOC wall: include / exclude business alerts

- **Scope control on the Alert radar wall** (footer, next to the buttons): *All alerts · Technical · Business*. Technical = the platform failed to answer (rules without a class count as technical), Business = the API answered no. The radar face, its legend, the severity strip (open now · P1 · P2 · P3 · per business) and the case file beside the scope all follow the scope; the subtitle says "technical alerts only" so a TV viewer knows what is hidden. Remembered per browser, carried in the URL (`#noc?cls=technical`) so a NOC bookmark opens on it, and **T** cycles the three scopes from the keyboard.
- Server: `GET /api/exec/radar?cls=` (the two radar faces alone, cheap) and `cls` on `/api/exec/radar/cell`; `execRadar.radarRows` and the case-file query join `alert_rules.alert_class`. The Executive Dashboard payload and its cache are untouched.

## 2.0.0-alpha.86 — 24 Sep 2026 — vLLM tab: "What WE really gain" — before / after, the race, what we win per scenario

- The page now speaks as our advice to Salam (we / our) throughout: where we are, what changes in our console, pick our scenario, our plan, our best approach.
- **Before → After panel**: left, today on the CPU (dimmed) — triage note, signature batch, Yusr answer, annotations per hour, backlog time, model; right, the chosen scenario in a glowing green card with the same rows, count-up numbers and a delta pill on each (−80 %, ×5 faster, ×15 …).
- **▶ Race it**: one triage note on both sides in real time (today's average scaled to 5 s on screen) — the green lane finishes, the grey one is still running; the caption says how many seconds of waiting that removes per day on triage alone.
- Three headline tiles (hours of waiting removed per day across agents and Yusr, annotations per hour, time to clear the backlog) and **What we win in each scenario**: A / B / C side by side with the same yardsticks (triage latency, capacity, backlog, waiting removed, run cost in SAR, data residency, time to first answer) and a fit score; clicking a card makes it our pick and recomputes the whole page.

## 2.0.0-alpha.85 — 24 Sep 2026 — Mission control: orphan runs after a restart

- A deploy restarts the agents mid-tick and leaves the `agent_runs` row without `finished_at`; the pulse showed that agent as *working* for 30 minutes. Now only the newest run per agent counts (20-minute cap) and orphans older than 20 minutes are closed as "interrupted (process restarted before the tick finished)" — they appear as a red dot in *what it did* instead of a phantom "running…".

## 2.0.0-alpha.84 — 24 Sep 2026 — Mission control: the robots react in real time

- `llm.js` keeps an in-flight register of every model call (purpose, caller, actor, started at) — `llm.inflight()`; `GET /api/agents/pulse` returns it with the agent runs in progress and the calls of the last 3 minutes.
- The page polls the pulse every 4 s: a robot switches to *working* the moment its call starts (Yusr shows "thinking… · answering <name>'s question", an agent shows "assess / triage / map — asking the model…"), packets flow on its wire, the card header follows — instead of waiting for the `llm_calls` row and the 30 s refresh. The "doing now" column shows the call in progress with a live timer.

## 2.0.0-alpha.83 — 24 Sep 2026 — vLLM tab in SAR, KSA market, references and the Salam sequence

- Costs in **SAR** (1 USD = 3.75) with KSA-market figures: on-prem L40S server ≈ 45–70 k SAR (L4 ≈ 22–35 k), in-Kingdom GPU rental (DCP L40S 5.2 SAR/h ≈ 3 800 SAR/month, A100 7.3 SAR/h, H100 17.27 SAR/h; Google Cloud Dammam G2/L4 via CNTXT ≈ 2 000 SAR/month), managed API per 1M tokens (DCP from 0.05 SAR) — all three editable in the 24-month cost chart, break-even A vs B in months.
- Options re-framed for Saudi Arabia: B = **KSA-resident GPU rental** (DCP, Google Dammam/CNTXT, Alibaba Riyadh, Oracle Riyadh) as the bridge and benchmark; C = **in-Kingdom managed inference** (DCP API, stc sovereign LLM platform, ALLaM on Azure AI Foundry / IBM watsonx) with the PDPL / on-prem-only caveat; global APIs excluded for incident data.
- **ALLaM-7B-Instruct** (SDAIA, Apache-2.0, vLLM-ready) added as a model choice for Arabic (Yusr, Arabic incident text).
- **Best approach for Salam — the sequence** (rent in-Kingdom 1–2 weeks → benchmark with the HUD → flip the order → buy the on-prem server with real numbers → ALLaM for Arabic → managed APIs only for non-sensitive tests) and a **References & solutions** grid of 13 public links (vLLM docs, model cards, DCP, KSA cloud-region status, stc, HUMAIN, GPU price guides, SDAIA PDPL).

## 2.0.0-alpha.82 — 24 Sep 2026 — vLLM tab: the value, drawn

- New **What you really gain** block on the Move-to-vLLM tab, all computed from the real `llm_calls` of the last 7 days and the chosen scenario: five before → after tiles (triage note latency, incidents annotated per hour, time to clear the unassessed-signature backlog, Yusr answer time, model size), then five charts — **latency per answer** (measured today vs projected per target, per agent), **capacity** (answers per hour: one CPU stream vs vLLM batching the planned concurrency), **backlog drain** curves, **effort vs value** bubbles (weeks to first answer × value × monthly bill) and a **24-month cumulative cost** line chart with editable server price and cloud monthly rate (break-even A vs B). Projection = prompt tokens ÷ 2 500 tok/s prefill + answer tokens ÷ per-stream speed of the GPU class (+ network for cloud); every figure is labelled indicative.
- The `LLM_ORDER` line in the config sample replaced by the real switch (Settings › Agents › Configure → order).

## 2.0.0-alpha.81 — 24 Sep 2026 — Mission control: performance HUD per robot · "Move to vLLM / GPU" tab

- **Performance HUD** on every robot (hover, click to pin): the PM2 process CPU % and RAM (`pm2 jlist`, 10 s cache), tokens today, generation speed (tok/s measured from answer tokens ÷ ms over 7 days), average and p95 latency, fail %, uptime and restarts. The brain's HUD shows the host (CPU % from /proc/stat, RAM, load, GPU via nvidia-smi when present) and the resident model on the model server (`/api/ps`: size, quantisation, CPU vs GPU).
- **Move to vLLM / GPU** tab on the same page: measured load of the last 7 days (calls/day, tokens/day, tok/s, average and p95, max concurrency, unassessed-signature backlog, busiest hour → required aggregate tok/s), the two `.env` lines that make llm.js use a vLLM server as fallback and the order flip in Settings › Agents, a scenario picker (on-prem GPU / cloud GPU VM / managed API × Llama 3.1 8B / Qwen2.5 14B / Qwen2.5 32B × concurrency) with GPU class, expected speed-up and answer time, three option cards with effort, indicative cost and verdict, the sequenced plan for the chosen option, and a comparison table. Prices and throughput are flagged as indicative ranges, not quotes.
- Server: `/api/agents/mission` now carries `perf` (host, pm2 processes, model server) and `usage` (7-day llm_calls per caller, daily totals, peak hour, max concurrent over 24 h; 60 s memo).

## 2.0.0-alpha.80 — 24 Sep 2026 — AI agents · Mission control

- New page **Mission control** (`#agents-live`, settings menu › AI, visible to every incident role — Mobile / Fixed alerts or monitoring, and super admins): four animated robots — Log intelligence, Incident triage, Team mapping, Yusr — wired to the on-prem brain (model, probe, tokens today, calls in the last 5 min; packets flow on the wire of an agent that is talking to the model). Each robot breathes and blinks, works (arms, gear, thinking dots) while its service runs or calls the model, sleeps when disabled, shakes red after a failed run, slows down amber when a tick is overdue; its speech bubble carries the last thing it did.
- One card per agent with three columns: **what it did** (every run of the last 48 h as a sentence, plus the concrete outputs — latest triage notes with 👍/👎, signatures explained, team proposals, the last daily report), **what it is doing now** (state, running-for / last-run, cadence, model calls of the last 5 min, today's calls · tokens · avg ms, 24 h sparkline) and **what it should do** (live countdown to the next tick, next daily report, the queue waiting — open incidents without a note, signatures to assess, rules without a team — and *needs a human*: proposals to approve, signatures to review, triage notes awaiting feedback, each with a link).
- **Replay last 24 h**: every run in order on a 24 h track (one lane per agent), Prev · Auto-play · Next (← →), slow / normal / fast, narration line; the robot whose step is shown works on the stage.
- Server: `GET /api/agents/mission` (`agentsMission.js`) — read-only over agent_runs · agent_triage · agent_signatures · alert_rule_team_suggestions · agent_reports · llm_calls · alerts; every query guarded, empty sections on a fresh install. Refreshed every 30 s on the page.

## 2.0.0-alpha.79 — 24 Sep 2026 — error-trend rollup fixes

- `fixed_error_msg_hourly`: `cls_auto` joins the primary key — one message can be technical under a 5xx and business under a 200 in the same hour, and the alpha.78 key made the day's insert fail (`ON CONFLICT DO UPDATE command cannot affect row a second time`), leaving the oldest days unfilled and the loop retrying the same day. The table is rebuilt automatically at boot and refilled a day at a time.
- `/api/fixed/errors/trend` no longer goes through respCache (2-min TTL + stale-while-revalidate served the empty pre-backfill answer for three minutes after deploy); a 20 s per-URL memo that is dropped after every rollup pass replaces it.

## 2.0.0-alpha.78 — 24 Sep 2026 — Fixed › Troubleshoot: evolution of each error by hour

- **Evolution by hour** card on the error control board: one line per error message over the selected period (Top 5 / 8 / 12 / 20, the rest summed into a dashed *Other* line, optional *All errors* area), hourly points up to 8 days and daily beyond (or forced), hover crosshair with every message's count at that hour, legend chips that hide / show lines, ⌕ on a chip filters the board on that message, the message selected in the *Error message* dropdown drawn bold. Follows the board's window, channel, type, provider, class, category, team, message and *Open only*; hidden while an identifier / free-text search is active (the rollup cannot answer those).
- **No read-model cost at page time**: new console-side rollup `fixed_error_msg_hourly` (hour × source × channel × type × provider × category × message → count, open, auto class) maintained by `fixedErrorTrend.js` — every 5 min the last 3 h are re-rolled, the last 48 h once an hour (resolved flags), history backfilled one day at a time (newest first) down to 92 days, retention 99 days. The chart reads the rollup only (`GET /api/fixed/errors/trend`, memoised per URL by respCache); business / technical honours the catalogue overrides at read time. `GET /api/fixed/errors/trend/status` shows rows, coverage and the last run.

# Changelog

All notable changes to the Salam MVNO Digital Console are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/); this project uses [SemVer](https://semver.org/).

## [2.0.0-alpha.77] — 2026-09-24 — Alert cases PDF: where the problem is, real samples
### Changed
- **Alert cases PDF rebuilt around "where the problem is"** (`alertCases.js`): page 1 now ranks the offenders over the
  whole population (step / endpoint family / category: counted, share of the counted, population, breach rate, p50 /
  p95 / max latency, most frequent reason) with a one-line verdict in red, then **one real sample per top offender** —
  method + full endpoint, status, duration, error, workflow / request id and the request and response bodies (masked
  at capture), taken from the workflow's api_calls — and only then the case rows (capped at 120 in the PDF, duration
  and code moved next to the step; the XLSX keeps the full list).

## [2.0.0-alpha.76] — 2026-09-24 — Incident evidence: who and where it failed (TKT-000065)
### Added
- **Evidence on every incident** (`server/src/alertEvidence.js`, `GET /api/alerts/:id/evidence`, incident drawer › EVIDENCE ·
  WHO AND WHERE): the affected rows behind the incident, computed live over its window. Fixed order rules → the order
  attempts from the dealer-ops read model with **order number, customer (last digits), journey · step, the last failing
  API call (method · endpoint · status · error), outcome / Nafath / last error, dealer / channel**, a **req / res** button
  that opens the attempt's calls with request and response bodies (masked at ingest), and a trace link. Fixed app-log
  rules (Yakeen, nexus, Salam Home) → endpoint, status code, reason, message, request id / state id, platform. Mobile
  rules → the failed calls of the metric family or the exact API: endpoint, code, message, transaction id. Users with
  **unmaskPII** get a "Show customer numbers" button; every unmask is written to the audit log (`pii.unmask`).
- **Alert mail**: an "Affected · top 5" table under each firing Fixed / Mobile alert (masked identifiers); the **PDF**
  attempt tables gained the order · customer and last-failing-call columns (`alertReport.js`).
- `GET /api/alerts/:id/evidence/calls?attempt=` — the calls of one attempt (bodies capped at 4,000 chars each).

## [2.0.0-alpha.75] — 2026-09-24 — Fixed range control: minute presets and custom start / end (TKT-000064)
### Added
- **TKT-000064 · Time range across all Fixed pages** (`fixed.js` range control, used by SDA map, QR map, Reports,
  Overview and the channel pages): quick presets **5 min · 15 min · 30 min · 1 h · 6 h · 24 h · 7 d · 30 d · 90 d** plus
  **Custom** with From / To date-time fields in KSA, Today / Yesterday / This week / This month shortcuts, validation
  (end after start, ≤ 92 days, not in the future) and the resolved window printed under the chips
  (`09/23 14:05 → 09/24 14:05 KSA · 24 h · live`). The window travels as `range=<key>` or `range=custom&from=&to=`
  (ISO), which every `/api/fixed` endpoint already accepts through `fixed360.parseScope` (minute presets added there),
  is remembered per browser and works in deep links (`#fixed?tab=map&range=custom&from=…&to=…`).

## [2.0.0-alpha.74] — 2026-09-24 — Alert journey: step player, narrated samples; Sigma is Fixed-only
### Fixed
- **TKT-000067 · Raise-a-ticket form cut off at 100 % zoom**: the ticket card overrode the modal's `overflow:auto` with
  `overflow:hidden` for its rounded corners, so on laptop screens the form was clipped at 88 % of the viewport with no
  scrollbar and Submit was reachable only with Tab or 75 % zoom. The card is a flex column now: the body scrolls, the
  header and the Submit / Cancel row stay pinned (`index.html` `.tkm-card` / `.tkm` / `.tkm-head` / `.tkm-actions`).
### Changed
- **Alert journey step player** (`alert-journey.js`): a replay no longer flashes through the map — every step is shown
  one at a time with its explanation in a sticky player bar under the map (stage · node · text · progress), with
  **◀ Prev · ▶ Auto-play / Pause · Next ▶**, a speed selector (1.5 / 2.6 / 4.5 s per step) and ← → keys, the same way
  the journey explorers work. The map scrolls to the current node, the stage detail follows, and every node visited so
  far stays lit. The six reference samples are now narrated step by step (25 / 20 / 10 steps Mobile, 26 / 15 / 7 Fixed)
  with KSA times, who acted, which clock ran and what it cost; a plain scenario is narrated with the generic rule text.
- **No Sigma for Mobile**: the Mobile journey lists TCS · Mobile Digital & BSS L2 as the BSS L2 (no `bss-l2`), and the
  L3 node reads "TCS → Oracle L3 · ADM Mobile · Evamp" on Mobile vs "Sigma → Oracle L3 · ADM Fixed" on Fixed.
  `server/src/teams.js` seed: `bss-l2`, `oss-l2`, `infra-l2` are Fixed-only teams (Sigma), TCS carries the Mobile BSS
  keywords for Agent 2; seeded rows nobody edited in Settings › Teams now follow the seed on boot (an admin-saved row
  is never touched).

## [2.0.0-alpha.73] — 2026-09-24 — Alert journey map (Mobile + Fixed › Explore)
### Added
- **Alert journey** (`alert-journey.js`): one big-picture map of everything an incident can go through — Detect →
  Evaluate → Open → Own → Work → Resolve → History — with the gates (enabled / hours / gateway, threshold & sample,
  impact count & customer floor, correlation & twins, hold / re-open), the people (ack, hand-over, re-assign, ServiceNow),
  Agent 2 (triage, rule → team mapping, duplicates), the contract clocks (response · restoration · resolution · RCA per
  vendor and severity) and the credit arithmetic (TCS weight × fee, Sigma weight × impact index, Oracle bands, Evamp
  hourly, with caps). Colour-coded stage columns, animated flows, a scenario player (severity, team/contract, source,
  ack / restore / RCA times, resolve reason, twist) that lights the exact path and draws the timeline against the
  targets, three reference samples per business line that replay on the map, and the tables of contract clocks,
  console ack SLA / reminder ladder and every way an incident closes. Follows the console theme (light / dark).
  Homes: Mobile › Explore › Alert journey (`#alert-journey`) and Fixed › Explore › Alert journey (`#fixed?t=alertjourney`,
  permission `fixed_explore`). Team names come from Settings › Teams.

## [2.0.0-alpha.72] — 2026-09-24 — Responder teams: incident ownership, re-assignment, manual tickets, Agent 2 rule → team mapping
### Added
- **Responder-team registry** (`server/src/teams.js`, tables `console_teams`, `console_user_teams`): business × domain ×
  level (Digital · BSS · OSS · Infra · ADM L3 fixes & enhancements · Network · SOC · Payments · RAFM · Sales), each bound
  to the vendor and the contract that carry its obligations. Seeded with 17 teams (Salam Digital Ops L1, TCS Mobile
  Digital & BSS L2, Sigma Fixed Applications L2, BSS L2 / Oracle BSS L3, OSS L2 / Oracle OSS L3, Infrastructure & DC,
  ADM Mobile L3 (TCS), ADM Fixed L3 (Sigma), Evamp DMS/UIL L3, Payments & Gateways, Subex RAFM, Network NOC, SOC, Sales
  Ops, OTP vendor); legacy free-text rule teams ("Digital Ops", "BSS Ops", "OSS Ops", "Sales Ops"…) resolve through
  the team **aliases**, so nothing had to be migrated. **Settings › Teams** (`teams.js`, super admin): edit teams, bind
  vendor/contract, mail DL, aliases, Agent 2 keywords; members with per-team rights (ack · resolve · re-assign); the
  team's contract clocks, open load, MTTR and the rules it owns.
- **Rights on an incident** (`teams.canActOn`): admins always; a member of the incident's team; the per-business ACK
  holders (`ack_mobile` / `ack_fixed`) as the on-call fallback; the current ack holder or the person who opened the
  ticket; an incident with no team → any `ackErrors` user. Enforced on **ack, hand-over target, resolve and
  re-assign** (`api.js`). Ack reminders (`ackSla.js`) now go to the team's members and DL first, ACK holders next.
- **Re-assign to a team** — `POST /api/alerts/:id/reassign {team, note}` (reason required): the ack is released so the
  new team's ack clock starts (first ack kept in `first_ack_at`), reminders reset, team mailed, system comment + audit
  `incident.reassign`. Alerts › ⋯ › *Re-assign to a team*.
- **Manual ticket** — `POST /api/alerts/manual`: an incident opened by hand (rule `manual_ticket` /
  `fixed_manual_ticket`, `source='manual'`, `created_by`) owned by a team from the first second — same ack SLA,
  reminders, exec radar, history and vendor clocks as a fired rule. Alerts › **＋ New ticket** drawer.
- **Incident drawer › Owning team & contract**: the team, whether the reader may act and why, the vendor / contract,
  and the signed **response · restoration · resolution · RCA** targets for this severity (from `vendorContracts.js`),
  with the escalation ladder link.
- **Agent 2 maps rules to teams** (`agentIncident.mapRules`, table `alert_rule_team_suggestions`): deterministic
  keyword scoring first (team keywords vs rule key / name / metric / description, side-aware), the on-prem model only
  for the ambiguous rules and only choosing from the registry; proposals wait for a human under **Alerts › Alert rules
  › Team mapping** (approve · reject · approve all ≥ 80 % · run now). Approve writes `alert_rules.team` (marked
  operator-edited so the seed keeps it) and moves the rule's open incidents. Runs 1 min after boot and every 6 h;
  `POST /api/agents/run/map`. Incident triage now offers the model the live team list and stores the team **key**.
- Users: responder-team memberships in the user panel (Settings › Users › Edit) and as chips in the list / CSV.
### Changed
- Alerts › Alert rules: the Agent 2 **Team mapping** review is the last section of the page (after rule changes); a small
  "N team proposals · review ↓" pill in the toolbar jumps to it while proposals are waiting.
- Rule editor › TEAM is a grouped dropdown of the registry (legacy label kept selectable); rules list shows the team tag
  and Agent 2's pending proposal per rule.

## [2.0.0-alpha.71] — 2026-09-24 — Vendors & contracts: signed-document review, five vendors added, financials
### Changed
- **Sigma and TCS re-baselined on the signed documents** (`server/src/vendorContracts.js`). Sigma: contract effective
  27 Jun 2024, renewal SLA from Amendment 1 / Fourth Addendum (resolution non-bug 4 h / 6 h / 1 BD / 2 BD, product bug
  per L3 vendor SLA), penalty = weight × impact index (1/2/3/5) with an aggregate cap of 10 % of contract price (no monthly
  cap), availability 99.99 % without penalty, onsite staffing 4, governance cadence. TCS: the binding SLA is **Amendment 1
  §2.7** (not the proposal); penalty cap **10 %** of monthly charges (was 5 %); per-system availability weights (DMS 3,
  Digital Apps 3, Web Portal 1, Kong 3, NetAxis 1, Backups 1); new-SIM fast KPI **30 s** (was 20 s); P2 RCA 1 %; payments
  reconciliation 98 % / 3 %, postpaid invoiced 99 %, MNP T1/T2 timers, MRC/bill-run durations, KT and resource SLAs;
  SIM-swap KPI removed (no contractual basis); WP1 **expired 20 Jun 2026** after Amendment 4.
### Added
- **Vendors: Oracle (MS OD SAL-14253496, Edge Catalyst OD, Enterprise ULA), Subex (RAFM 138-2022 + Amendment 1),
  Comviva (DMS LoA 197-2024), Infosys (TCoE 187-2025, Rimal DC 214-2025), Evamp & Saanga (TeC DMP L3 proposal)** —
  `server/src/vendorContractsSeedExt.js`: 8 contracts, 21 obligations, 14 penalty rules, 5 escalation ladders, 10
  evidence maps, assignments; merged into the defaults by id.
- **Financials per contract** (`contract.financials`): value, term, monthly recurring fee and basis, one-off/milestones,
  by-period amounts, payment terms, man-day pools and rate cards, liability caps, the **contract chain** (LoA →
  amendments with date, period, amount, change) and renewal due. Eligible monthly fees seeded from the contracts
  (Sigma 464,100; TCS 697,064; Oracle 916,000; Subex 152,114; Comviva 91,975; Infosys 228,848) — validate with Finance.
- **Contracts tab redesigned** (`vendor-contracts.js`): money tiles, financial terms, penalty clause, sources, contract
  chain table; **renewal radar** banner and vendor-card badges (expired / due within 90 days) computed from
  `effectiveTo` / `financials.renewalDue`.
- Saved configs now **merge obligations and assignments by id** with the defaults, so new vendors appear without
  "Reset defaults"; config version 4.

## [2.0.0-alpha.70] — 2026-09-22 — The executive brief makes the case for a Salam product: what it took, what it can become
### Added
- **Slide 13 of `exec-brief.html` — "What it took · one initiative, end to end".** Seven cards at executive level, one
  per discipline the platform demanded: programme (two consoles into one, in a quarter, eight phases part-time),
  experience (26 roles across ten teams, L1 → L2 → L3, bilingual, phone and iPad), interface (24 pages, one design
  language, exports, hand-built), depth (177 alert rules, 33 DMS flow rules, objectives, baselines, 423 API endpoints,
  42 tables, 15 collectors and probes, ≈77,000 lines), AI (Yusr and the two agents, the model measured on our own
  server, budgets and audit), journeys (21 Mobile, four Fixed channels, dealer journeys read from the DMS source) and
  integrations (32, with the evidence). A band states what this proves — one person, ten months, alongside the day job,
  no licence — and names the author.
- **Slide 14 — "What it can become · the Salam B2B opportunity".** The need (every operator in the Kingdom runs on the
  national integrations we already watch and has the same blind spot), Salam's edge (born inside a Saudi operator,
  proven on ~1.5M customers on two businesses, data in the Kingdom, AI on-premise, zero licences), the offer (Salam
  OpsConsole, white-labelled, shared cloud / dedicated cloud / on-premise, Salam as reference customer and distributor),
  what is already in hand (a white-label build with a synthetic demo tenant, a product page in English and Arabic, a
  ten-minute demo) and the proposal: a joint taskforce, Digital Operations with Salam B2B, to package, brand and price
  it this quarter — no capex, no headcount. No market sizes and no revenue figures on purpose.
### Changed
- **The close reads "Sponsor. Launch. Commercialize."** — pillar three is the joint taskforce with Salam B2B; the next
  phase is folded into pillar two; the KPI strip shows customers (~1.5M), rules (177) and licences (0).
- Convergence slide k-lines carry journeys, channels and "0 licences"; the AI slide is framed as sovereign, on our own
  infrastructure, with the measured model figure and "AI proposes, people decide"; the value slide closes on
  "Observability there is revenue protection"; the title lede adds "— and protecting revenue".
- **`exec-script.html`** follows: run of play (15 slides, ~44 min), sections 13–15 rewritten (opening line, cues, the
  numbers worth saying, bridges), two new Q&A entries ("Can this be sold outside Salam — and who would own it?" and
  "What would commercialising cost Salam?").
### Notes
- Merged from a second draft of the brief reviewed on 22 Sep: its structure (opportunity slide before the ask, the
  commercialize pillar, the sovereignty framing, "from cost centre to product line", the joint-taskforce ask) was kept;
  its invented figures (market size, incident timings, "3 seconds", "3x traffic", "zero downtime", "Tier-IV",
  "zero-trust", "Arabic answers") and its placeholder screenshots were not.
- Every figure on the new slides is counted from this repository, not estimated: 84 + 163 JS modules, 29,049 + 45,071
  lines of JS plus the page and the schema, 423 `/api` routes, 42 tables, 15 collector/probe modules, 33 DMS flow rules.
- Web-only: no server change; `/api/version` keeps reporting the last full deploy.
### Verified
Rendered headless at 1920×1080, 1600×900, 1366×768 and 1280×720: slides 2, 7, 12, 13, 14 and the close fit above the
navigation with no clipping, no horizontal scroll and no console errors; dots, counter (15 / 15) and keyboard
navigation include the new slides.

## [2.0.0-alpha.69] — 2026-09-21 — Service levels: one tab per business
### Changed
- **The SLA page (Service levels) has two tabs, MVNO | Fixed.** It was one grid mixing both
  businesses, so "SLO / SLA" on the Executive Dashboard's Fixed panel landed on MVNO cards first.
  Each tab shows its own SLO cards; anomaly detection and the vendor-health pointer are MVNO-only
  (both read the MVNO journey rollups), so they appear on the MVNO tab only; the acknowledgement SLA
  shows that business's card and reminder history.
- Each tab carries its verdict before it is opened: objectives, met, at risk, breached, no data,
  with the worst status as a chip ("1 breached", "2 at risk", "all met").
- **The tab is part of the URL** — `#slo?tab=mobile|fixed` (`mvno` accepted), kept current with
  `replaceState` so a copied link opens the same view. Without one, the page opens on the tab last
  used (`slo_tab`), else the first business the account holds. A single-business account sees only
  its business, with no tab bar, and a link to the other business's tab is corrected, not obeyed.
- **Every "SLO / SLA" link on the Executive Dashboard now opens its business's tab**: the
  availability tile, the availability obligation rows and the panel links, per business. The home
  page's anomaly rows open the MVNO tab, where anomalies are.
- ⚙ SLO definitions opens on the same business as the tab; "← SLA health" returns to the business
  that was being edited.
### Notes
- Switching tabs re-filters what is loaded — no second `/api/slo` call — and does not re-render the
  acknowledgement section: the other business's card is hidden, not removed, so an unsaved edit
  survives a switch and Save still sends both businesses (a PUT built from one card would have sent
  half a config).
- Web-only: no server change; `/api/version` keeps reporting the last full deploy.
### Verified
Headless against the real stylesheet and the shipped `slo.js` / `acksla.js`, 29 checks: deep links
for both tabs, the `mvno` alias, last-tab fallback, the Fixed-only account, click and ← / → keyboard
switching with the URL, audit and ARIA following, no refetch on switch, an edit on each card kept
across switches and both sent by Save, a theme re-render keeping the tab, and the definitions
round-trip. Rendered at 1280 / 820 / 390 px in light and dark: no horizontal scroll, no console
errors.

## [2.0.0-alpha.68] — 2026-09-21 — Vendor & integration health moves to Monitoring
### Changed
- **Vendor & integration health left the SLA page for Monitoring › Gateway & API.** "Which of our
  partners is failing" — payment gateways, couriers, CITC / Semati / Nafath / BSS — is a monitoring
  question, not a service-level one, and on the SLA page it sat between the SLO attainment cards and
  anomaly detection, belonging to neither.
- It sits **above** the tab's numbered request path (① API gateway → ⑤ OSB) as the overview: read it
  first, then walk the numbers to find the layer at fault. Vendor health is not a hop on that path — it
  is every partner at its far end — so numbering it would have broken the sequence the tab is built on.
- Same `/api/vendors`, same colour thresholds (≥ 95 % green, ≥ 85 % amber), same bars and volumes.
  Its window stays its own (24 h / 7 d / 30 d) because the page window stops at 7 d and this section
  has always offered 30 d; the choice now persists per user (`mon_vend_win`), as the tab itself does.
- The SLA page is retitled **Service levels** and carries a link to the new home, so anyone who goes
  looking for it where it used to be finds where it went.
### Fixed
- A slow `/api/vendors` answer can no longer overwrite a newer one when the window is switched
  mid-request (sequence guard). The old version on the SLA page had that race.
### Verified
Rendered headless with the real stylesheet and the renderer sliced out of the shipped
`monitoring.js`, at **1280 / 820 / 390 px in light and dark**: nine rows in three groups, no horizontal
scroll at phone width, no console errors, the window buttons themed rather than browser-grey in both
modes, and a click on 7 d refetching `window=168` with the active state following it.

## [2.0.0-alpha.67] — 2026-09-20 — Yusr is generation-bound, and it is not alone on the box
### Notes — what the numbers actually said
`llm_calls`, 24 h on 152, all on `llama3.1` (the only model pulled, 4.9 GB, CPU-only):

| purpose | calls | avg | prompt chars | failed |
|---|---:|---:|---:|---:|
| `yusr.chat` | 6 | **66 s** | 16,627 | 0 |
| `agent-log.assess` | 89 | **56 s** | 4,272 | **44** |
| `yusr.warm` | 83 | 32 s | 11,489 | 2 |
| `agent-incident.triage` | 40 | 21 s | 2,323 | 0 |

Two things follow, and neither is about data:
- **`yusr.chat` is generation-bound.** 861 characters of answer is ~215 tokens against the 220 cap,
  at roughly **3.3 tok/s**. No amount of caching touches that; the cap is the only lever that moves
  it linearly.
- **Yusr is competing for the box.** Those four purposes are ~2.4 hours of CPU inference a day on a
  single Ollama, and `agent-log.assess` alone burns 83 minutes of it while **failing 44 of 89 calls**
  at the 75 s timeout. A question asked while an agent is mid-call queues behind it.
### Added
- **`maxTokens` is now an Assist setting** (60–400, default unchanged at 220), so the answer-length
  cap — and therefore most of Yusr's latency — can be tuned and reverted from Settings › Assist
  without a deploy. 120 is about half the wait for a noticeably shorter answer.
### Fixed
- The first cut of that change referenced an undeclared `cfgMaxTokens`, which `node --check` passes
  and which would have thrown at runtime on the first question asked. Caught before deploy.
### Notes
`yusr.warm`'s 11.5 k-character prompt is deliberate, not a bug: it keeps the evaluated `SYSTEM_BASE`
prefix in the slot cache, which a bare "ok" would evict. The cost is 32 s of CPU every 20 minutes,
which matters only because the box has no headroom to spare.

## [2.0.0-alpha.66] — 2026-09-20 — Measure the other one too
### Added
- **`/api/subscriber` now reports its phases** on an `X-Console-Timing` response header — profile,
  audit, mask — because it went from **50 ms to 6.18 s** between two deploys and nothing in it was
  measured, so the cause was unknowable. A header rather than the payload, so no consumer's shape
  changes. The audit is a WRITE to `unified_console` on the shared server that ran out of
  connections earlier tonight, which makes it the phase most likely to move with load — but that is
  a hypothesis, and the header is how it gets tested instead of assumed.
### Notes
alpha.65 measured well on the rest: `complaints` **7133 ms → 87 ms** once the two nexus queries
stopped competing for a two-connection pool, and `/api/fixed/customer` **17.9 s → 2.0 s** with the
whole answer cached.

## [2.0.0-alpha.65] — 2026-09-20 — Cache the answer, not a piece of it — and undo my own regression
### Fixed
- **The timings said I had been caching the wrong thing all evening.** Measured on 152 for one
  customer: `complaints 7133 ms · nexus 5014 ms · attempts 1853 ms · inventory 0 ms`, total **22 s**.
  Caching the nexus link was never going to fix that — attempts, complaints and inventory are each
  slow in their own right. The whole Fixed answer is now cached, exactly as the mobile profile is,
  which is what took that one to **50 ms**.
- **MASKED ANSWERS ONLY.** An unmasked lookup is privileged and audited; serving one from a shared
  cache — or seeding the cache with one — would put unmasked PII in front of someone whose request
  was never audited for it. `unmask=1` bypasses in both directions, and the cache stays in process
  memory, never on disk.
- **`--clear` now clears both halves of a customer.** A customer has two in-memory entries, the
  mobile profile and the Fixed answer, and "forget this customer" has to mean both — or the half you
  did not think of is the half that is stale in front of an executive.
### Fixed — a regression I introduced an hour earlier
- **alpha.64 made this endpoint slower, not faster.** Starting the complaints query alongside the
  nexus scan looked like free parallelism. It is not: `db.nexus` is a **two-connection** read-only
  pool and `fixedInventory` reads it as well, so three concurrent consumers meant one waited out the
  15 s connection timeout and the whole lookup failed — `timeout exceeded when trying to connect`,
  **22 s and no answer**, against 15 s and an answer before I touched it. The rule I should have
  applied: **parallelise across pools, serialise within one.** Attempts (the ops pool) now runs
  alongside the nexus work; the two nexus queries take their turn.
- `timeout exceeded when trying to connect` now counts as a timeout for the backoff and the negative
  cache. It did not match the old test, so a connection failure was retried in full every time.
### Notes
`builtAt` is on the Fixed payload now, as it already was on the profile, so a cached answer can say
how old it is rather than looking live. The underlying queries are still slow on a cold customer —
`findAttempts` ends in `iccid ILIKE '%'||$1||'%'`, a leading wildcard no index can serve, and the
complaints join is unindexed at 7 s. Those are the real fixes; caching is what buys the time to do
them properly.

## [2.0.0-alpha.64] — 2026-09-20 — Forgetting a customer, and finding the other 15 seconds
### Added
- **`warmup.js --clear <id>` and `--clear-all`.** A stale cached profile in front of an executive is
  worse than a slow fresh one, so dropping a customer had to be one step. It clears BOTH halves: the
  in-memory profile and the persisted nexus row — which is addressed by hash, so the server is the
  only thing that can find it, the identifier having deliberately never been stored. Behind it,
  `POST /api/cache/lookup/drop` (super admin, audited; the keys themselves are not written to the
  audit log, only how many).
### Fixed
- **Caching the nexus scan took `/api/fixed/customer` from 45 s to 15 s, and I could not say where
  the other 15 s went** — because every phase ran end to end with nothing measuring it. Two changes,
  in that order:
  - **`timings` is now in the response** and in the warm script's output, per phase. A slow customer
    now says which part was slow instead of just being slow.
  - **Complaints no longer queue behind everything else.** `findComplaints` (a nexus query with its
    own 8 s budget) depends on nothing above it, yet ran after attempts → nexus → inventory, one
    after another. It now starts immediately and is awaited where it was always used.
### Notes
Measured on 152 before this change: profile **50 ms** against `/api/fixed/customer` **15.4 s** with
the nexus link already cached — which is what proved the regex scan had never been the only problem.
The remaining suspects are `findAttempts`, whose WHERE ends in `iccid ILIKE '%'||$1||'%'` (a leading
wildcard, so no index can serve it and `order_attempts` is scanned end to end), and the complaints
query. The timings will now say which, without guessing.
### Also settled
The 2-vs-3 question that started this: the warm reports **3 orders for both the national ID and the
contact number**, with no collision flag — so all three are his, the third simply carries no national
ID, and the CMS filter has been hiding a real order. Nothing on the console needs correcting; the
label now explains it.

## [2.0.0-alpha.63] — 2026-09-20 — A cache that could never fill, on a page that waited for it
### Fixed
- **The nexus cache could never populate for the customers it was built for.** It stored the answer
  only on SUCCESS — so a scan that always times out was never cached, and the page paid the full
  12 s on every single load, for ever. My error, found on 152 within the hour: `nexus_link_cache`
  sat at **0 rows** through two clean deploys. A timeout is now a persisted answer too — an empty
  list on a deliberately short retention — so the page stops paying for a question we already know
  we cannot answer quickly, while a real answer is still free to arrive and replace it.
- **That scan was gating the WHOLE page, not the Fixed tab.** `sub360.js` awaits
  `Promise.allSettled([mobile, fixed])`, so Customer 360 sat on "Loading profile…" behind a query
  that has nothing to do with the mobile profile. Rather than restructure the page the night before
  a demo, the wait is now bounded server-side: an interactive caller gets whatever the scan produced
  within `NEXUS_LINK_WAIT_MS` (2.5 s), and if it is still running the request returns and the scan
  carries on in the background to fill the cache for the next look.
- **One scan per customer, however many callers ask.** Three tabs open on the same customer meant
  three sequential-scan regexes racing each other over the same 24 months of rows. They now share
  one in-flight promise.
- **The warm path pays the cost so the screen never does.** `warm=1` gets `NEXUS_LINK_WARM_SCAN_MS`
  (120 s) instead of the interactive 12 s, and waits for the answer, so the slow query runs once,
  offline, and lands in the persisted cache.
### Added
- **`server/src/warmup.js` — warm any list of customers on demand**, which is what was actually
  wanted rather than a fixed env list:
  `node src/warmup.js 2635308931 966511600080` or `node src/warmup.js --file ids.txt`.
  It talks to the RUNNING server over loopback on purpose: the profile cache lives in that process's
  memory (nothing on disk, deliberately), so a standalone CLI would warm its own memory and exit
  having achieved nothing. Per customer it prints the profile time, **the order count**, the Fixed
  time, the number of nexus links cached, and flags a contact-number collision — which also makes it
  the fastest way to answer "how many journeys does the console think this customer has" without
  opening a browser. Ids are arguments only: written nowhere, masked to four digits in the output.
### Notes
The mobile half of the cache is in memory and is lost on restart; the nexus half is persisted and is
not. So after any restart, re-run the script — or leave `DEMO_WARM_KEYS` set and let boot do it.

## [2.0.0-alpha.62] — 2026-09-20 — The warm-up warmed the wrong half
### Fixed
- **alpha.61 shipped a warm-up that left the slow half cold.** `startWarm()` called
  `subscriber.profile()` only — the MOBILE profile. On 152 it reported `warmed 1/1` and looked
  correct, while `nexus_link_cache` stayed at **0 rows**. The mobile lookup is the ~1 s one. The
  half worth warming is the Fixed bridge, a regex over `workflow_states.context::text` that takes
  12 s or times out and prints *"could not link through nexus"* on the page — which is the failure
  this whole cache was built to stop appearing during a demo.
- The warm now calls `fixedCustomer.lookup({ key })` as well, so a boot fills both. `req` is omitted
  deliberately: no `req` means no unmask, so the warm reads masked and raises no audit event,
  exactly as an anonymous page load would. The Fixed half is the persisted one, so unlike the
  in-memory profile it survives every later restart.
- The boot line now reports both halves — `warmed N/N profile(s) · M/N fixed link(s)` — so a repeat
  of this is visible in the log instead of reading as success.
### Notes
Nothing was wrong with the cache; the verification was just narrow enough to miss it.
`nexus_link_cache` being empty after a clean run is the tell, which is why that query was in the
verification block. Opening Customer 360 once by hand fills the same row and it persists for ten
days, so this can also be fixed without a deploy.

## [2.0.0-alpha.61] — 2026-09-20 — An order is his only if his national ID says so
### Fixed
- **Customer 360 and the CMS admin disagreed on how many journeys a customer has, and both looked
  equally confident.** `subscriber.js` matches `onboarding_orders` on the **contact number** as well
  as the national ID; the CMS filters on the national ID alone. A contact number is a field somebody
  typed onto an order, not an identity — so the console could show an order the CMS hides (his own,
  created before an ID was captured) and, in the bad case, **an order belonging to whoever else typed
  the same number.** On screen the two were identical, so the count could not be trusted either way.
- Every row now carries **`match_basis`**: `nid`, `contact_no_nid`, or `contact_other_nid`. A row
  matched only by contact number **and carrying a different national ID** is somebody else: dropped
  from the lines, dropped from the Journey & Orders badge, and reported as **a count only** — the
  operator learns the number is shared and learns nothing about the other customer. A row with **no**
  national ID stays, because hiding a real order is the worse error, but it is labelled rather than
  silently counted as confirmed. With no national ID resolved at all, nothing is dropped and
  everything reads `contact?`.
- **The header was showing the plan under the word "order".** `sub360.js` rendered
  `Onboarding order: ${i.current_plan}` — so "122 · Solo 149" was the price plan, and anyone reading
  it concluded the customer had one order. It now reads `Plan: … · N onboarding orders`.
### Added
- **A lookup cache that keeps customer data off disk** (`lookupCache.js`). Explicitly **not**
  `respCache`, which persists bodies to `RESP_CACHE_FILE`: a subscriber profile is PII and the house
  rule keeps customer identifiers out of `unified_console` and off disk. This module imports no
  filesystem at all — memory-only by construction, not by intention, and a test asserts that.
  Serve-stale-and-refresh: a hit is instant, an entry past the soft window refreshes behind the
  viewer. `LOOKUP_CACHE_TTL_DAYS` (10) bounds how long a key is remembered;
  `LOOKUP_CACHE_SOFT_SEC` (600) is what actually governs freshness.
- **`DEMO_WARM_KEYS`** — keys warmed 20 s after boot, one at a time, so a restart never costs a
  demo. It holds customer identifiers, so it lives in `/apps/unified/.env` and nowhere else, and
  every log line this module writes masks the key to its last four digits.
- **`nexus_link_cache`** — the one thing in this path that is persisted, and it stores **no
  identifier**: `key_hash = sha256(LOOKUP_HASH_SALT || '|' || key)` plus the nexus workflow ids,
  which mean nothing without nexus. **With no salt configured the code writes nothing at all**
  rather than write a hash a ten-digit national ID could be brute-forced out of. Swept to the same
  retention on boot and daily.
### Fixed — the timeout that was about to happen on stage
- `fixedCustomer.nexusLinkIds()` runs `context::text ~ $1` — a **regex over a JSON column** across
  24 months of `workflow_states` under a 12 s budget. No index can serve it; it is a sequential scan
  with a per-row regex, it timed out tonight, and the page prints *"could not link through nexus"*
  to whoever is watching. It cannot be made fast, so it is now **answered from cache** on the second
  and later lookups, and a timeout sets a short in-memory backoff so one doomed scan does not make
  every later page load stall another 12 s behind it.
### Notes
The 2-vs-3 question this started from has a real answer either way, and the new label says which:
three rows tied to his contact number, two carrying his national ID, and a third — lining up with
the refunded 13:58 charge on 06 Aug against the two successes — that is almost certainly his and
that the CMS has been hiding all along.
### Verified
**100 assertions (35 + 35 + 12 + 18), all green**, order-independent, against a real PostgreSQL 16.
The matching SQL and the filter are sliced verbatim out of the shipped `subscriber.js`. The fixture is
the real shape of this case: two orders with his ID, one with none, and one belonging to a different
national ID under the same contact number. The old query matches all four; the new one keeps three,
counts the fourth once, and never lets the other customer's national ID into the payload.

## [2.0.0-alpha.60] — 2026-09-20 — The alert got quieter as the incident got worse
### Fixed
- **A probe that cannot connect because the server is FULL was reported as a flaky probe.** Tonight on
  the shared PostgreSQL server `172.31.15.121:5432` (where `unified_console`, `mvno_console` and
  `sda_ops` all live): **19:49 WARN at 83 %, 20:04 CRIT at 94/100, then 20:09 “WARN · probe failed” —
  while the server was actually at 100 %.** Severity fell as the situation deteriorated, which is the
  worst failure mode an alert can have.
- The cause is structural, not a typo: **the saturation check needs a connection in order to measure
  saturation.** Once the slots ran out, `dbChecks()` threw on connect and every connect failure fell
  into one generic `catch` that emitted `level: 'WARN', prodImpact: false`. Four probes — Console DB,
  Local replica, Local Nexus copy and Fixed ingest — all downgraded together for the same reason.
- A probe refused for lack of a slot is **not** a degraded probe. It is the saturation reading at its
  maximum: every application on that server is being turned away. It now reports **CRIT with
  `prodImpact: true`**, and says so — including that the reserved superuser slots exist for exactly
  this moment. Detection is **SQLSTATE 53300**, which covers both wordings PostgreSQL uses:
  “sorry, too many clients already” and “remaining connection slots are reserved for non-replication
  superuser connections” (the second is what a non-superuser sees once only the reserved slots remain).
  A message test backs it up in case a pooler drops the code.
- Everything else keeps its old behaviour on purpose — `ECONNREFUSED`, a timeout, bad credentials, a
  missing database are all still WARN. A down server is a different alert from a full one.
### Notes
The console was **not** the cause and the check said so: its own role held **6** of the 94, against a
configured pool budget of **26**. That is the number to sit with — if the console ever used the pool it
is allowed, the same server would be asked for **114 of 100**. The saturation is a shared-server
capacity problem (44 abandoned pgAdmin sessions at the last honest reading), not a console problem, but
the console is one busy hour away from being a contributor rather than a witness.
### Verified
**12 assertions**, with the classifier sliced verbatim out of the shipped `prodHealth.js` — both real
wordings from tonight's emails, the bare SQLSTATE, a `FATAL:` prefix, mixed case, and five error shapes
that must **not** be promoted. One of them caught a bug in my own test rather than the code: the
partial-phrase assertion was written inverted against its own description.

## [2.0.0-alpha.59] — 2026-09-20 — The executive view carries platform health, and nothing else
### Fixed
- **The Payment tile was the last business number on the Executive Dashboard**, and alpha.58 could only
  put a label on it: “1,010 failed · all outcomes — a decline is business”. Declines are the customer's
  bank, not us; an executive view that grades the platform on them is grading the wrong thing.
- **Payment did have a technical half. It was never in `payments.status`.** `errors.js` has owned the
  definition since August — `payment_stuck`: the gateway returned a commit and the app never finalised
  it, >30 min old, excluding “initiated with no commit” (a customer abandoning the page, not a stuck
  payment; that exclusion mirrors `Payment#actual_pending?` in selfcare-backend). alpha.57's guard was
  right — a technical-only rule on the decline column computes `ok / (ok + 0)` and reads 100 % forever
  — but its conclusion that the journey has no technical signal was too broad. The signal was one
  category over, already classified technical, showing **32 in 168 h**.
- So the tile is now **Payment reliability** — `settled / (settled + unconfirmed)` — with a new
  objective, `mobile_payment_reliability`, **locked technical** and **deliberately given no `journey`**,
  because a journey-backed rule would read the constant-business payment rollup and report a permanent
  100 %. `mobile_payment_success` is untouched: it remains the conversion objective, all outcomes, on
  the SLO page and Troubleshoot › Payment, where a commercial number belongs.
- **The decline count cannot reach the executive payload by any route now.** `h.payRate` and
  `h.paidFail` are gone from `mvnoExec`, and so is `paidFail` from the day series — nothing charted it,
  and data that rides along in the JSON is how a number creeps back onto a slide. Five assertions guard
  this structurally rather than by inspection.
- **Fixed › Order funnel health left the executive row.** Conversion counts where attempts *stop*, not
  why they failed — a customer who closes the tab is indistinguishable from one the platform lost — so
  23.7 % on a platform-health line invites being read as “the platform is 23.7 % well”. It keeps its card
  on Fixed › Operations, is flagged `commercial: true`, and no longer raises a warning on the Fixed
  status line.
- **The reliability tile shows no delta.** `dPay` is a change in paid *volume*; under a ~99 % rate it
  reads as reliability moving. Volume trend stays on Orders and the Payments OK chart.
- **A missing count reads `nowire`, never a green 100 %.** The failure mode this whole thread has been
  about, closed explicitly this time and asserted twice.
- **The SLO page stopped over-promising.** An objective with neither a rollup journey nor a metric
  snapshot used to claim it was measured “on the Executive Dashboard and SLA attainment”; there is no
  attainment series to draw, so it now says exactly where it is measured and that no attainment card
  will appear.
### Notes
Default target for the new objective is **≥ 99.5 %**, editable like any other. It is a placeholder, not a
measurement: set it from the real unconfirmed rate once a week of data exists. A 95 % target here would
be the permanently-green trap alpha.58's notes warned about, one metric later.
### Verified
**70 assertions (35 + 35, was 31 + 19), all green**, order-independent, against a real PostgreSQL 16.
`STUCK_COND` is sliced out of the shipped `errors.js` and the tile arithmetic out of the shipped
`mvnoExec.js`, so neither is restated in the test. The ones that matter: 200 settled, 40 declined, 3
stuck, 5 abandoned, 2 in flight → **98.5 %**; adding **500 more declines does not move it**; adding 7
unconfirmed payments does.

## [2.0.0-alpha.58] — 2026-09-20 — The Executive Dashboard and the SLO page now give one answer
### Fixed
- **The KPI tiles ignored Counts.** With `Count business errors` off, the SLO page reported Activation
  technical-only while the Executive Dashboard tile still read **79.3 %** — the all-errors number — carrying a
  colour and a target taken from the very objective it was contradicting. One console, two answers to
  “is activation healthy”. **Activation success**, **Nafath completed**, **Change plan** and the Fixed
  **API error budget** now compute the same half their objective does, and name it on the tile
  (“· technical only”) so the number is never ambiguous about what it counted.
- `homeKpisFromSource()` supplies the technical half of each class-capable failure count straight from the
  source tables. The exec tiles read raw `activation_logs` / `nafath_logs` / `change_plan_logs`, **not** the
  rollups, so alpha.55’s `err_class` column could not have served them — three class-filtered counts were
  the only honest way. The business half is the remainder of two counts, never a third query.
- **Payment now explains itself.** It cannot honour a technical-only default (alpha.57), and without a word
  on the tile it just looks like a tile that ignored the switch. With the default off it reads
  “… failed · all outcomes — a decline is business · target ≥ 95 %”; with the default on it says nothing,
  because then nothing is surprising.
### Notes
Change plan moves the most: on the classified 30 days it is **253 failures, 0 technical**. Its health-strip
line flips from “down” to “up” the moment the switch is off — which is the point, because a
not-eligible refusal is the customer, not the platform. Payment stays at its all-errors number by design.
### Verified
**50 assertions (31 + 19, was 31 + 10), all green**, against a real PostgreSQL 16. The new ones drive the
change-plan strip line and the payment note from the shipped source, sliced verbatim rather than restated,
and assert the note never claims a technical-only number payment cannot produce.

## [2.0.0-alpha.57] — 2026-09-20 — Payment and Delivery cannot be measured technical-only, and now say so
### Fixed
- **Two objectives would have read 100 % met forever.** `errclass.sourceCls()` classifies `payments` and
  `delivery_requests` with a **constant** `'business'`, by the codebase's own doctrine: a decline is the
  gateway answering "no", and cancelled / refused / RTO are business outcomes. A gateway timeout never
  reaches those journeys at all — it becomes `payment_stuck`, outside this rollup. So a technical-only
  setting on **Payment success** or **Delivery success** would compute `ok / (ok + 0)` and report a
  permanently green objective measuring nothing. Both are now marked not class-capable, and the Counts
  control shows the reason where the choice used to be.
- Confirmed against the first real 30-day classification on 152: payment **70,699 business / 0 technical**,
  delivery **111 / 0** — not a sampling artifact, a definition. `change_plan` also showed 0 technical but
  keeps its choice, because it has a real classifier and simply saw none in the window; the difference
  matters and the code now distinguishes it.
- **A drift test** asserts the declaration against reality: for every journey objective, a source table
  classified by a constant must not be capable, and one with a real classifier must not be marked
  incapable. If the doctrine in `errclass` changes, the test fails instead of the console quietly lying.
### Notes
First full classification of the MVNO journeys, 30 days to 20 Sep: **162,939 failures, of which 256 —
0.16 % — are technical.** Eligibility alone is 74,308 business denials against 211 technical. The seven
journey objectives have been measuring customer and policy outcomes, not platform health, which is the
whole reason this switch exists. Worth re-reading the targets with that in mind before flipping it.
### Verified
31 assertions (was 26), all green, against a real PostgreSQL 16.

## [2.0.0-alpha.56] — 2026-09-20 — cli.js could not reach a database when run by hand
### Fixed
- **`node src/cli.js <anything>` died with `getaddrinfo ENOTFOUND db`.** The CLI is run from a shell, where
  PM2's environment does not exist, and `db.js` reads its connection strings at module load — so every
  command fell back to the docker-compose default and pointed at a host called `db` that exists on no
  server. The alpha.55 `rollups --days 30` rebuild hit exactly this: it reported all nine journeys
  "skipped", wrote nothing, and threw. `sql.cjs` never had the problem because it finds and parses the
  app's own `.env` itself; `cli.js` simply never did.
- It does now, before `require('./db')` — the same loader, **parsed in Node**, never `set -a; . .env`,
  which makes the shell evaluate values carrying spaces and angle brackets (a pattern that has broken a
  cron on this box; `SMTP_FROM="Salam Operations Console <ops@salam.sa>"` is exactly that shape). An
  already-exported variable still wins, so a one-off override on the command line keeps working. It looks
  for `ENV_FILE`, then the app root beside `server/`, then `/apps/unified/.env`, `/apps/console/.env`.
- **A rebuild that wrote nothing now says so and exits non-zero**, instead of printing a row count of 0
  under a list of per-journey "skipped" lines and reading like success.
### Verified
Four assertions on the loader itself, sliced out of the shipped `cli.js` and executed: the URLs arrive
from the app `.env`, an `export `-prefixed line is parsed, a value carrying spaces and angle brackets
survives intact, and a variable already exported in the shell is not overwritten.

## [2.0.0-alpha.55] — 2026-09-20 — An SLO can count technical failures only, and says so
### Added
- **Counts — business vs technical, on every SLO** (Settings › SLO definitions). One page-wide default,
  *Count business errors*, that every objective inherits, plus a per-objective override in the definition
  modal beside Rule and Unit. Switch the default off and the console measures **platform health**: a BSS
  timeout counts, a declined card does not. The value each objective ended up with is shown on its card,
  so an operator can see at a glance why one reads differently from the error board.
- The distinction was already in the codebase, invisibly and inconsistently — three Fixed objectives had
  `cls: 'technical'` hard-coded into their metric dim, a group is literally called *MVNO business
  outcomes*, and the Fixed API error budget had the split computed two lines above where it was used and
  thrown away. This makes it one explicit, visible property instead of four private conventions.
- **Whether a signal can be split is code, not configuration** (`slo.CLASS_META`), and the editor can
  never write it. Three shapes, all rendered rather than hidden, because a control that is silently
  ignored is worse than one that explains itself: *capable* (the operator picks), *locked* (the objective
  exists to measure that one class — denials, the technical error budget — shown disabled with the
  reason), and *not split* (latency, conversion, unwired probes — likewise).
- **`rollup_hourly` now carries `err_class`**, classified at refresh by `errclass.sourceCls()` — the same
  expressions the Troubleshoot board has used since August, so the two lanes cannot disagree. This is what
  makes the seven MVNO journey objectives class-aware at all; they previously aggregated a failure as
  simply `fail`. It is set only on `fail` rows, so every existing reader that sums `cnt` over the old keys
  is unaffected. `node src/cli.js rollups --days N` rebuilds a window.
### Fixed
- **Two ways this would have quietly lied, both closed before shipping.** The Fixed app and board metrics
  are recorded as one snapshot row *per class*, so a Counts setting of "All" would have matched both rows
  and **double-counted the ticks** — `classAllowed` stops that ever being offered or resolved for them,
  which is also why they were hard-coded to technical in the first place. And rollup rows written before
  this change carry `''`, which is UNCLASSIFIED, not business: a class-filtered objective whose window
  still contains them **refuses to answer** — `nodata`, with the count, the date the split starts and the
  rebuild command — instead of reporting a flattering number.
### Verified
26 assertions against a real PostgreSQL 16 with the real `slo.js`, `rollups.js` and `errclass.js`. The one
that matters: the *same hour* of payment data reads **90 % and breached** counting all errors and **98.9 %
and met** counting technical only — same rows, different question, which is the whole point. Also: a denial
objective stays business even when told otherwise; the technical error budget stays technical under the
all default; latency is never filtered; the per-class metrics never resolve to "all" even when "all" is
forced into the stored config; a window holding 400 unclassified failures returns nodata with the fix in
the message while the all-errors reading of the same rows is unaffected; and the rollup classifies a 504
gateway timeout as technical, a user rejection as business, and a payment decline as business by doctrine,
without inventing or losing a row. `schema.sql` applied twice to a fresh database — the primary-key swap is
idempotent. Rendered at 1280, 834 and 390 px in both themes: no horizontal scroll.

## [2.0.0-alpha.54] — 2026-09-20 — Super admins can see the console through another user's account
### Added
- **View as user** (Account → VIEW AS USER, Super Admin only). Pick any enabled console user and the console
  loads as *they* see it: their roles, their capabilities, their business scope (Mobile / Fixed / both) and their
  saved home dashboard. The existing **Preview as role** covers the role alone, so it could never reproduce the
  question people actually ask — "why can't I see this?" — which is almost always the per-account business scope
  or a role set held on that specific account, not the role in the abstract. Both controls stay; the modal now
  says which one answers which question.
- Two invariants make it safe, and both are tested rather than asserted in a comment:
  - **Identity never changes.** `req.actor` stays the super admin, so every audit row and every incident comment
    still names the person who really acted, and `audit()` stamps `viewing_as` on anything done through the other
    account. `realRole` / `realRoles` are computed before the substitution and never overwritten — which is also
    what keeps the way back reachable, since the control that ends the switch is gated on the real role.
  - **The session is read-only.** Enforced as a method check at the front of `/api/`, not a route list, so a route
    added tomorrow is closed by default: every non-GET is refused `423` with a message naming the account. The
    only exceptions are the two routes that start and stop the switch — you can always get out.
- A persistent bar is fixed to the bottom of every page for as long as the switch is live, naming the person, the
  role, the side of the business and the read-only state, with **Return to my account**. The same escape hatch is
  repeated at the top of the Account modal, and the profile editor and role preview are disabled there.
- The switch is gated on the roles the **session** user holds in `console_users`, never on a header, so
  `X-Console-View-As` does nothing at all for anyone who is not already a super admin — it is not an escalation
  path, it is a lens. A disabled account, an unknown address and your own address are all refused. The header is
  added once in `ops.js` `authHeaders()`, which the global fetch wrapper applies to every `/api/` call, so the
  switch covers the whole app rather than the handful of modules that build their own headers.
- Starting and stopping are recorded in the audit trail as `me.view_as.start` / `me.view_as.stop` with both
  identities; a non-super-admin probing the routes is recorded as `RESTRICTED_ATTEMPT`.
### Verified
37 assertions against the **real** middleware, read-only guard and routes — sliced verbatim out of the shipped
`server/src/api.js` and run on a real Express app over a real PostgreSQL with the real `roles.js` and
`rolePerms.js`, so nothing in the test re-implements the logic it is checking. Covers: the header is inert for a
non-super-admin (role unchanged, no capability picked up, routes 403 and audited); a super admin viewing a
Fixed-only L1 gets that role, those capabilities and `business='fixed'` — 3 views where their own session has 16,
and *not* forced back to both; `req.actor` and `realRole` unchanged; an audited read carries both identities;
every write refused with 423 while reads keep working; stop reachable through the guard; disabled, unknown and
self addresses refused; the picker omits disabled accounts and your own; the address trimmed and case-folded; and
view-as taking precedence over the older role-preview header instead of mixing the two. The modal and the bar
were rendered at 1100, 834 and 390 px in both themes: no horizontal scroll.

## [2.0.0-alpha.53] — 2026-09-20 — Resolving an alert now sticks: the operator can hold a rule while its window drains
### Fixed
- **A resolve was being undone by the next sync, and the operator's reason and name were wiped with it.** A rule is
  not counting up from a start point that can be reset — there is no cursor. Every metric is recomputed **from zero
  over a rolling window** `[now − window_hours, now)` on every tick, so a resolve changes nothing about the condition:
  while the window still holds the events that tripped the rule, the condition is *still true*, and
  `alertRunner.reopenRecent` flips the row a person just closed straight back to `open` — clearing `resolve_reason`
  and `resolved_by` on the way. On a 24 h rule that is a full day of the console overruling the operator; the seed set
  has 18 rules at 24 h, one at 48 h and four at 168 h. `reopenMin: 0` was never the answer: it only turns each
  re-fire into a **brand-new** incident with a fresh mail and page — the 872-rows-in-4-days behaviour flap control
  was introduced to stop.
- The resolve dialog now carries a **hold**: *until the window drains* (the rule's own `window_hours`, capped at
  **12 h** so a 168 h rule can never blind the console for a week), 1 h, 4 h, 8 h, or no hold. While a hold runs the
  rule is still evaluated — it simply does not re-open the incident that was closed, and does not open a new one.
  The hold retires itself, writes *"Hold expired"* on the incident discussion, and only then can the rule open a
  **new** incident, if it is still breaching at that point.
- The hold lives on the **rule**, not the incident, because past `reopenMin` the next fire is a new row that a
  per-incident flag could never stop. It is wall-clock, never `sim_now`: a person asked for quiet until a real time
  of day, and in replay mode `sim_now` is a virtual clock walking over a static dump.
- A held rule is never silently quiet. The Alerts page shows a **held bar** above the table — rule, severity,
  window, who held it, why, and until when in KSA — with **Release now** to end a hold early. The tick logs the
  held rules, `runAlerts` returns a `held` count, and the resolve and the release are both on the incident timeline
  and in the audit trail.
- A hold only blocks **opening**. An incident that is already open keeps updating, escalating and paging as before.
### Fixed (found while testing this)
- **The hold expiry comment was never written.** `RETURNING` on an `UPDATE` hands back the row *after* the write, so
  `RETURNING held_alert_id` on the statement that clears it always returned `NULL`. The sweep now reads the expiring
  rows in a CTE and returns from that side, which still holds the pre-update values, in one statement.
### Verified
22 assertions against a real PostgreSQL 16 and the real `alertRunner.js` — starting with a test that **reproduces the
reported bug exactly**: resolve, one tick later the same row is back open, `reopen_count` incremented, reason and
resolver gone. Then: four breaching ticks under a hold leave exactly one incident, still resolved, reason and
resolver intact; expiry sweeps the hold, opens a **new** incident and leaves the resolved one untouched; a hold never
stops an already-open incident updating; `hold=window` on a 1 h rule holds for 1 h, not a blanket mute. Plus 16
assertions on the hold-token maths and the endpoint SQL (including that a Fixed hold never leaks into the Mobile
list, and that releasing twice 404s instead of silently succeeding), the full `schema.sql` applied twice to a fresh
database to prove the new columns are idempotent — boot runs it on every restart — and the existing twin-collapse
suite re-run unchanged. The held bar was rendered at 1280, 834 and 390 px in both themes: no horizontal scroll.

## [2.0.0-alpha.52] — 2026-09-19 — Semati moves to Regulatory Affairs, and a restart no longer leaves a run claiming to be in progress
### Changed
- **Semati Clearance moves from IT GOVERNANCE to REGULATORY AFFAIRS**, beside CST Arqami and CST Escalations. It
  writes to the CITC/TCC national number registry — the same stakeholder as those two — so that is where it belongs.
  The gate moves with it: the menu item and every `/api/semati/*` route now require the **`cst`** view instead of
  `governance`, plus the `sematiClear` capability as before. Menu and route have to agree or a role sees an item
  that 403s, so both moved in one change, and a test now asserts which view the routes actually demand.
  **Access is unchanged**: Super Admin could reach it before and still can.
### Fixed
- **`sematiClear` was granted to Admin and did nothing** — Admin holds neither the `governance` nor the `cst` view,
  so the tick box was inert, and it would have switched registry writes on silently the day anyone granted Admin
  `cst` for Arqami. Exactly the accidental-privilege shape alpha.42 set out to remove. The default is now Super Admin
  alone; the role editor grants the view and the capability together, deliberately, with no deploy.
- **A run interrupted by a restart is settled at mount** (`server/src/semati.js` `reconcile()`). Rows that were never
  sent sat at `pending` and the job at `running` for good, so the history would claim a run was still going with no
  process running it. The job now becomes **interrupted** with a finish time, and every unsent row says *"The console
  restarted before this row was sent. It never reached Semati, so this pair is unchanged and safe to run again."*
  Rows that already have an answer keep it — those were sent. Idempotent: a second mount settles nothing.
- This matters more than it sounds. Measured on 152, a pinned row costs **~2 s** (ssh handshake + TLS handshake to
  TCC), so the 2,935-row file is a **1.5–2 hour** run — a deploy landing in the middle of one is a real possibility,
  not a theoretical one. The result page explains the state and tells the operator to re-run the unsent pairs.
### Verified
A new suite that runs a job, kills it mid-flight, puts the database back into the exact shape a hard kill leaves
(job `running`, 20 rows `pending`), then calls what mount calls: the job lands on `interrupted`, no row is left
`pending`, the 10 rows that were really sent keep their verdicts, the unsent ones carry the explanation, and a second
pass is a no-op. Plus the existing suites green: 32 end-to-end in each transport, 7 pins, 9 hints.
### Note
Two stale assertions in the test harness were corrected in the same pass — one asserted hint wording that alpha.51
deliberately changed, the other dropped tables after the module had cached its `ensure()` promise, which was a race
in the test rather than in the product. Both were checked against the running code before being changed.


## [2.0.0-alpha.51] — 2026-09-19 — Semati: TCC's certificate is self-signed, so pin their key instead of trusting the path
### Fixed
- **The TLS diagnosis in alpha.50 was wrong and is corrected everywhere.** `openssl s_client` from `172.31.43.17`
  returned `issuer == subject == C=SA, O=Technology Control Company, OU=Semati, CN=semati.tcc-ict.com`. That is not
  an interception proxy — **TCC serves a self-signed certificate on its own production endpoint**. There is no CA to
  install and strict validation will never pass, so the hint no longer sends anyone hunting for a proxy.
### Added
- **`SEMATI_CLEAR_TLS_PIN_SHA256` — public-key pinning.** `SEMATI_CLEAR_TLS_INSECURE=1` alone means trusting whatever
  answers on that address. With the pin set, the chain is skipped but TCC's exact key must match or the call fails:
  `curl --pinnedpubkey sha256//…` on the ssh path, an SPKI check on the socket for the direct path (Node skips
  `checkServerIdentity` entirely when `rejectUnauthorized` is false, so the check has to be explicit). A `sha256//`
  prefix in the value is accepted. Unset leaves alpha.50 behaviour, so it can be adopted without a flag day.
  `deploy152/env.template` carries the one-liner that reads the pin off the API host.
- **A wrong key is reported as a decision, not a glitch** — curl's `(90)` and the socket mismatch both resolve to a
  hint that says the presented key is not the pinned one, that TCC may have rotated, and not to clear the pin to make
  it go away without finding out which. Nothing is sent when the pin fails.
- **The page states the posture**: `TLS pinned to TCC` (green) when a pin is set, `TLS not verified` (amber) when
  `SEMATI_CLEAR_TLS_INSECURE=1` stands alone.
### Fixed (found while testing the above)
- **A pooled TLS socket handshakes once, so a pin checked only on `secureConnect` was enforced on the first call and
  silently skipped on every reuse** — worse than no pin, because it reads as protection. Every direct request now
  gets its own connection (`agent: false`) and the check also covers a socket that arrives already secured. Caught by
  a test that pinned correctly, then pinned wrongly, and watched the wrong pin pass.
### Verified
7 pin checks against a real self-signed HTTPS endpoint — Node's SPKI equals what `openssl dgst` prints, correct pin
passes, `sha256//`-prefixed pin passes, wrong pin refuses with the hint, curl's `(90)` classifies, no pin is
unchanged — run twice to catch reuse, plus the 32 end-to-end checks green again in both transports, and the
`--pinnedpubkey` flag confirmed in the exact curl the ssh path builds.


## [2.0.0-alpha.50] — 2026-09-19 — Semati: the health check now says what to do about a failure
### Changed
- **The reachability check turns an error into the next action** (`server/src/semati.js`). The first production probe
  from `172.31.43.17` came back `strict 000 — SSL certificate problem: self signed certificate` while `-k` got a clean
  `405`: something terminates TLS between the API hosts and TCC, which is exactly why the operations script carried
  `curl -k`. The raw curl string told an operator nothing, so `hintFor()` now names the switch — set
  `SEMATI_CLEAR_TLS_INSECURE=1`, or install the intercepting CA on that host and keep verification on — and does the
  same for DNS, egress, timeout and SSH-hop failures (both curl's English and Node's `ECONNREFUSED`-style codes).
  The hint rides on `/api/semati/health` and on the `reason` of any row that failed at transport, and it always ends
  with the fact that nothing was sent.
- **The page shows the hint and the TLS posture.** An unreachable probe renders the hint as a banner above the two
  steps instead of hiding the error in a tooltip, and while `SEMATI_CLEAR_TLS_INSECURE=1` is set a permanent
  **TLS not verified** chip sits next to the health chip, so an unverified hop to a national registry is never
  invisible. Verified headless in both themes: reachable-with-the-switch, and a real self-signed endpoint refused.
### Note
No change to what is sent to Semati or to how an answer is classified. `roles.js`, the routes and the storage model
are untouched since alpha.49.


## [2.0.0-alpha.49] — 2026-09-19 — Governance › Semati Clearance: release MSISDN + ID pairs on TCC, from the console
### Added
- **Semati Clearance** (`server/src/semati.js`, `semati-clearance.js`, gear menu › IT GOVERNANCE). Paste a list or load
  a `.xlsx` / `.csv` / `.txt` of `MSISDN, customer ID[, ID type]`, review what would be sent (validated, de-duplicated,
  the type inferred from the ID's first digit — 1… national ID, 2… iqama — and a contradiction flagged), confirm, and
  watch every row come back as **Cleared**, **Not cleared** or **Error**. Mobile and Fixed (5G home), scoped by the
  session's business. Cancel mid-run leaves unsent rows untouched. History per run; "Check a number" answers whether a
  pair was ever sent, from a keyed hash. Result file as XLSX.
- **The same call the operations script made** — the TCC `individual/v2/verify` endpoint with `requestType 4`, the
  same payload shape, the same operator block — now with the outcome, the operator and the time on the record.
  From a 2,935-row production run: code **600** = released; code **727 MOBILE_DOESNT_EXIST** = not registered under
  this ID, which TCC does not split into "already released" vs "wrong ID" — so the console says exactly that and does
  not guess; 715 / timeout / HTTP 5xx = **Error**, not a verdict, retry later.
- **Where the call is made from.** 152 has no internet, so the request is issued ON an API host (the boxes that already
  talk to Semati) over the collector SSH channel, `curl` with the JSON body on stdin — the api key is in no argv, no
  shell history. `SEMATI_CLEAR_TRANSPORT=direct` for a host with egress or the local mock. The page shows reachability
  from that vantage point before anything is sent.
- **The outcome is stored, never the customer.** Jobs and rows go to `unified_console` with identifiers masked (last
  3 digits) plus an HMAC of msisdn|ID for the lookup. The full values live in process memory for
  `SEMATI_CLEAR_RESULT_TTL_MIN` (120) after the run — the window for downloading the result file — then only the masked
  outcome remains. Full values on screen or in the file: the run's own author, or `unmaskPII`; every reveal, run, cancel,
  export and lookup is audited (`semati.clear.start`, `semati.clear.cancel`, `pii.unmask`, `semati.export`, `semati.lookup`).
- **A `sematiClear` capability** (`roles.js`, its own column in the matrix, granted to Super Admin and Admin by default).
  It writes to a national registry, so a role gets it deliberately, never as a side effect of another tick box.
  The page and every `/api/semati/*` route need the `governance` view **and** this capability; the endpoints are on the
  Fixed-team allow-list so a Fixed-only session can clear 5G numbers.
- **Configuration is `.env` only** — `SEMATI_CLEAR_API_KEY`, `SEMATI_CLEAR_OPERATOR_JSON` (+ optional `_MOBILE` / `_FIXED`),
  transport, host, TLS, request type, pacing, caps — documented in `deploy152/env.template`. The page stays locked, naming
  the missing keys, until they are set. Nothing about Semati is stored in console settings.
### Verified
- 32 end-to-end checks against a real PostgreSQL and a mock TCC endpoint, in both transports (`direct`, and `ssh` through
  a stand-in `ssh` that proves the key never reaches argv): normalisation, the real 2,935-row workbook, classification of
  600/727/715/timeout/502, masking in the database, author vs `unmaskPII` reveal, XLSX export that re-reads, hash lookup,
  business scoping, 409 on a concurrent run, cancel mid-run, both gates, the audit trail. The page rendered headless in
  both themes at 1440×900 and 390×844 through every state — empty, review, confirm, running, finished, full reveal,
  history, lookup, locked — with no horizontal overflow and no page errors.


## [2.0.0-alpha.48] — 2026-09-19 — North-star KPIs second on the exec brief; menu rows light like dropdown rows
### Changed
- **"Are the north-star KPIs moving?" moves to second position** on the Executive Dashboard, directly after
  "Are we OK right now?" — status, then the north-star numbers, then the cost, the vendors and the follow-up.
- **The number in front of each question is now its position, not a constant.** `qnum()` reads the index out of
  `execbrief.js` `V2`, so reordering the page renumbers it. It used to be the first element of each `TITLES` row,
  which meant moving a section would have left the old numbering behind; those rows are now
  `[question, description, window]`.
### Fixed
- **Menu rows light like dropdown rows** (`index.html`). Inside `.helpmenu` — the gear menu and the "?" menu —
  only `.active` styled anything, so hovering **Alert radar** in the gear menu left its icon grey while the
  identical row in the Mobile or Fixed dropdown turned green. The icon now fills green on hover and on focus,
  the row slides 3 px, and the current page keeps the green inset bar and gradient icon the dropdown panels use.
  `.hm-tour` icons are green at rest by design, so they take a ring rather than a second green — which also keeps
  them legible in dark mode, where `--green-dark` is lighter rather than darker. Motion is dropped under
  `prefers-reduced-motion`.


## [2.0.0-alpha.47] — 2026-09-19 — The two alpha.46 misses: the radar was on a different list, the gear never lit
### Fixed
- **The alert radar really does leave the Executive Dashboard now.** `#exec` is rendered by `execbrief.js` — the
  CEO/CIO brief ("Are we OK right now?", "What did it cost us?") — and its section list is `V2`, not the
  `EXEC_SECTIONS` alpha.46 edited. `'radar'` sat second-to-last there, right before `'foot'`. It is out of `V2`
  and out of that page's subtitle. Both lists now agree, and the NOC wall is untouched: `nocwall.js` asks EXECOPS
  for `sections:['radar']` itself, `SECTION.radar` is unchanged, and the `◉ NOC wall` button in the page header
  is the way there.
- **Opening the gear menu now lights the gear** (`settingsmenu.js`). `.on` was set only by `window.openSettings()`,
  i.e. once you had already landed on a settings page — so pulling the menu down left the gear grey with its own
  panel hanging underneath it, which is what alpha.46's new styling had nothing to act on. A `syncGear()` helper
  owns that state now, so opening, closing, Escape, an outside click and a nav tab all agree, and the gear still
  stays lit while a settings page is the current view. The NOC-wall entries keep their old behaviour of not
  lighting it, because a wall is a page rather than a settings segment. The `"?"` needed no change —
  `helpmenu.js` was already setting `.on` on open. Verified headless against the real module and the real
  stylesheet, in both themes: at rest muted, menu open solid green with a white glyph, on a settings page solid
  green, hover green throughout.
### Note
Front-end only — `server/src/roles.js` shipped in alpha.46 and is unchanged, so this deploys with `--web-only`
and no restart. `/api/version` is stamped from `server/build.json`, which `--web-only` does not copy, so it keeps
reporting `2.0.0-alpha.46` until the next full deploy.


## [2.0.0-alpha.46] — 2026-09-19 — Twelve more roles across four new teams, and the nav icon buttons restyled
### Added
- **Twelve roles on one ladder — OSS, Infra, Data and Enterprise IT, each L1/L2/L3** (`server/src/roles.js`).
  The console now has **26 roles across ten teams** instead of 14 across seven, so every team that operates
  something at Salam has a role of its own rather than borrowing `l2_digital`. The rung means the same thing
  everywhere: L1 reads the team's pages, acknowledges and exports; L2 adds its escalation page and alert-rule
  tuning; L3 adds the L2 Workbench and its own dashboard layout. PII unmask is granted to **L3 OSS only**, on
  the same reasoning as L3 Digital — an end-to-end case needs the real identifier. Nobody in the twelve gets
  `manageUsers`, `adminTools` or `manageSync`. Every one is a default: Settings › Users › Roles edits them live.
- **Enterprise IT is onboarded, not yet monitored.** RA hub, HR hub, Contracting, Jira and MSD are not a
  business scope in this console — there are two, Mobile and Fixed. The three Enterprise roles exist so the
  team can be created, reviewed in the matrix and given the cross-business pages now; Enterprise pages attach
  to them when a third scope is added, with no change to anybody's role.
- **The escalation ladder can route to all of them** — the tier picker in Notifications & escalation
  (`notifycfg.js`, `notifyclone.js`) went from 5 tiers to 17.
### Changed
- **The alert radar was removed from `execops.js` `EXEC_SECTIONS`** — which turned out not to be the list that
  renders `#exec`, so the page was unchanged. The live list is `execbrief.js` `V2`; corrected in alpha.47.
- **The gear and the "?" got the hover and selected styling of a nav tab** (`index.html`). The glyph goes green
  on hover and solid green while the menu is open or one of its pages is current. Until now hover turned the glyph
  *ink*, so hovering read as less selected than resting, and the open state was a pale tint a projector washed out;
  an older `#tourBtn.on` tint further down the same sheet was also winning on source order and is gone. The `"?"`
  lights correctly from this release. **The gear does not** — nothing ever set its `.on` class when its own menu
  opened. Fixed in alpha.47.
- **Role labels are no longer a hard-coded list of ten** (`ops.js`). `ROLE_LABELS` carries all 26 and is
  hydrated from `/api/roles`, so a custom role shows its real name too. The Super-Admin "preview as role"
  picker is grouped by team and ordered by rank — 26 flat options is a scroll, not a choice. Before this, anyone
  on a newer role saw the raw key (`l1_oss`) as their job title and could not be previewed at all.
- **Both decks carry the real numbers.** `exec-brief.html`: 24 pages / **26 roles**, and the access slide reads
  26 across ten teams. `product-brief.html`: the teams slide is now **twelve cards** — the ten teams, how a role
  is built, and the shared spine — with the chip strip, the access slide, the before/after row and the closing
  KPI all moved to 26 roles and 10 teams. Verified at 1600×900, 1024×768, 768×1024 and 390×844: nothing clipped,
  no horizontal scroll. On a tablet the teams grid drops to three columns and sets the "Opens on" line aside.


## [2.0.0-alpha.45] — 2026-09-19 — A product brief: the console as a Salam product, for every team
### Added
- **`product-brief.html`** — a second deck, separate from the executive brief and leaving it untouched, at
  `/unified-console/product-brief.html`. Fourteen slides that promote the console as a product rather than report on a
  programme: what it is in one sentence; the seven teams that open it and what each one lands on; the four screens that
  answer the four questions; the six capabilities behind twenty-four pages; why the alerts get read; the three AI
  capabilities running on Salam's own hardware; Customer 360 on the front line; thirty-two integrations as
  accountability; access and PII; built in-house with no licence; the added value as a before/after; what lands next;
  and a close that asks teams to take a role. Same design system, timings and controls as the executive brief.
- **A second deck button on the Executive Dashboard.** `DECKS` replaces the single `BRIEF` constant in `execops.js`:
  each deck is probed with HEAD and its button appears only when the file is actually deployed, so neither deck can
  show a broken modal. `openBrief()` is kept as an alias and `openDeck(key)` is exported.
### Changed
- **The decks read on a phone.** Below 760 px a slide scrolls instead of clipping, so the same file works on a
  projector, on an iPad and in the hand during a rehearsal. Verified at 1600×900, 1024×768 and 390×844 — nothing
  clipped, no horizontal scroll, no console errors on any of the fourteen slides.


## [2.0.0-alpha.44] — 2026-09-19 — Speaker notes for the executive brief
### Added
- **`exec-script.html`** — the notes for presenting the brief, at `/unified-console/exec-script.html`. One opening line
  per slide, the cues under it, the numbers worth saying out loud, the bridge into the next slide, and six likely
  questions with answers. Cumulative timings (~38 min) with the two slides to drop first marked. Readable on a phone,
  prints to 8 A4 pages with its own print stylesheet, light by default with a dark toggle for a dim room.
### Changed
- **The brief drops the August/September comparison slide** — 13 slides. Its numbers are carried by the convergence
  slide that follows it, and the deck opens faster without a table of what used to be true.


## [2.0.0-alpha.43] — 2026-09-19 — Executive brief rewritten for the September story
### Changed
- **The executive brief goes from 6 slides to 14**, sized for a 30–40 minute review with high management rather than a
  six-minute skim. The design system, the timing model and the closing ask are unchanged; the story is not.
  New: what changed since August as a side-by-side (one business → two, 66 rules → 177, one console instead of two);
  the convergence and why a shared spine makes the second business cheap; where customers actually stop, as a funnel
  rather than an up/down; alerting that earns attention, including the tuning that took open Fixed incidents from 14 to
  1; service objectives as a number agreed in advance; a worked example of a business escalation settled the same day
  with the evidence attached, told without naming anyone; the regulator as a stakeholder (Arqami, CST escalations);
  and access, PII masking and the audit trail — the questions a CIO asks that the August deck did not answer.
- Title, timeline and closing figures updated to September: both businesses live, ten months rather than nine, 177
  governed rules, and the executive role that opens the same live platform with no operational page behind it.
- Every "open the console" link now points at `/unified-console` instead of the superseded `/digital-console`.


## [2.0.0-alpha.42] — 2026-09-19 — Every page is in the permissions matrix; a CIO role; the roles editor rebuilt
### Added
- **Six pages entered the permission model.** `exec` (Executive Dashboard), `noc` (both NOC walls), `governance`
  (SLA · vendors & contracts · SLO definitions), `cst` (Arqami · CST escalations), `audit` (Audit log) and
  `tickets` (Tickets & feedback). Until now each was gated privately in `ops.js` with `style.display` or a
  `realRole === 'super_admin'` test, so none appeared as a matrix column and nobody could review who reached them —
  and Executive Dashboard and the NOC walls simply rode on `dashboard`, which is to say everybody. They survive both
  business scopes, because none of them belongs to Mobile or Fixed alone.
- **CIO / Executive role** — the narrowest in the console: the Executive Dashboard, the NOC walls, Yusr and export.
  No operate pages, no Customer 360 (that view carries PII), no edit caps. It is what the `exec` view was created
  for: before it, the only way to hand someone the executive dashboard was to hand them Home and everything keyed to it.
- **`adminTools` capability** — the ticket board, the error log, rule reseed and the health self-check. Admin holds it.
### Changed
- **Roles & permissions is a role-centric editor**, not a 14 × 33 grid of bare checkboxes under rotated headers. Pick a
  role on the left; edit it on the right with pages grouped the way the nav is grouped (Mobile · Fixed · Cross-business ·
  Shared), a select-all per group, the sentence that says what each capability actually grants, and a live preview of
  the navigation that role would get. The wide grid survives underneath as a read-only heat map for "who can export?".
  Saving shows the diff and how many people each change touches, and warns when anyone loses access mid-session.
  Each role row carries its user count and never-signed-in count, so a change is no longer made blind. Works on a
  phone (the role list becomes a scroll strip) and in dark mode.
- **`/api/roles/matrix` reports usage** — users, never-signed-in and last sign-in per role.
- **Labels that drifted when the nav moved**: Analytics / SLA → **Reports**, Fixed · Errors → **Fixed · Troubleshoot**,
  and "Explore links" → **Explore & Customer 360**, which is what that view actually gates.
- **A role now starts where it can.** `#`, `#home` and `#dashboard` resolve to the landing page, which needs the
  `dashboard` view; every role had it, so it never mattered — the CIO does not. Landing on a page the session cannot
  open now routes to its first reachable page instead of greeting it with ACCESS DENIED, and the denial panel's
  "Go to my home page" button follows the same rule instead of guessing at the first visible nav tab.
### Fixed
- **User management was one tick box away from anyone.** `/api/users` and `/api/roles/matrix` were gated on the
  `manageUsers` CAP — a checkbox inside the very matrix those endpoints edit, and `rolePerms.addRole` can mint a
  custom role carrying it. Both, plus `POST/DELETE /api/roles`, are now `requireSuper`: the tier decides, the tick
  box only decides whether the UI offers the page. The gear entry also hides for non-super instead of opening a page
  that 403s — an Admin could previously click "User management" and collect an error.
- **`manageUsers` was doing five unrelated jobs.** It also gated the ticket board, the error log, rule reseed, the
  health self-check and the interface feature flags, so granting "can manage users" handed over all of those, and an
  ops manager had to be made a user administrator to answer a ticket. Those move to `adminTools`.


## [2.0.0-alpha.41] — 2026-09-19 — Affected cases work for the DMS flow rules
### Fixed
- **Every `dms.flow.*` alert exported an empty Preview / XLSX / PDF.** `alertCases.casesFor()` resolves the cases
  behind an alert from a `CASES` map keyed by `metric_key`, each entry a SQL twin of the metric it mirrors. The DMS
  flow rules have no such entry — they do not evaluate a source table, `dmsFlowRules.js` runs each rule against the
  DMS data tier every tick and writes what it matched into the console's own `dms_flow_findings.sample` (jsonb, the
  first 40 rows). With no entry the lookup fell through to `supported:false`, so the file carried a header row, no
  cases, and the untrue line *"not row-based — this metric is computed from aggregates, not from individual rows"*.
  The rows existed all along, one table away. `dms.flow.*` now resolves against the finding written by the same
  evaluation that opened or last kept the alert, and the export holds the cases the rule actually matched.
  Columns come from the sample itself, so each rule exports its own shape (L5: time · row id · status; L1: last seen ·
  dealer · codes · failures), ordered for reading rather than in the order jsonb happens to return keys.
  The metadata is honest about what it could not give: the rule's true window (it ends early so in-flight journeys
  can finish), `the rule stores the first 40 of N` when a run was capped, and a specific reason when there is nothing
  to show — the run errored, it stored no sample, or the finding has aged past `DMS_FLOW_RULES_RETENTION_DAYS`.
- **Every alert-cases export claimed "Identities: unmasked (audited export)".** True for the SQL-backed metrics, false
  for a DMS flow rule, whose identifiers are masked by `dmsFlowRules.maskRow()` when the finding is captured and can
  never be unmasked afterwards. Both the XLSX metadata sheet and the PDF footer now say which of the two applies.
- **A source timestamp could be shifted three hours.** The writers ran every `*_at` column through `ksa()`. That is
  right for a `timestamptz` (pg returns a Date), wrong for a DMS flow sample, which carries the source system's own
  clock as a string — converting it again moved the case three hours. Strings now pass through as captured.
### Changed
- **`csql` reads the app's `.env` itself, in Node.** It took the connection string from the process environment only,
  so its own help said `set -a; . ../.env; set +a` — the one pattern that must not be run on 152, because the file
  holds values with spaces, parentheses and angle brackets and the shell evaluates them (it has broken a cron here
  before; sourcing the current `.env` errors on the third line). It now parses `/apps/unified/.env` the way the
  census scripts do, an exported variable still wins, and a missing one says which variable and which file.
- **`csql --ops` / `--ops-beta`** reach the Fixed read models (`order_attempts`, `error_events`, `api_calls`). Those
  URLs are Prisma-style, and node-pg ignores their `?schema=` — every query would have silently read `public`, the
  PROD read model, instead of the beta one. The schema is stripped from the URL and pinned as `search_path`, the
  footer names the pool and schema it actually read, and a URL that carries `?schema=` but cannot be parsed warns
  instead of answering from the wrong schema.


## [2.0.0-alpha.40] — 2026-09-18 — Monitoring is a level of its own; the NOC wall moves to ⚙
### Changed
- **The business menus have a second level.** A section (OPERATE / EXPLORE) can now hold a named family of pages
  that folds on its own, one indent in, with its own page count — same disclosure behaviour, remembered per
  business, and folding one family never folds the section around it (`adaptive.js`, built from a
  `<div class="navsubg" data-sub="k">` label plus the `.navtab[data-sub="k"]` rows below it in `index.html`).
- **Mobile › OPERATE › MONITORING** now holds **Connectivity & APIs** (the page formerly listed as "Monitoring")
  and **DMS**. The two are the same thing seen from two sides — the rails and providers, and the dealers riding
  them — so they read as one family instead of two unrelated rows.
- **Fixed › OPERATE › MONITORING** now holds the four digital channels — **Epurchase**, **Salam Home**,
  **SDA map**, **QR codes** — so Fixed opens the same way Mobile does: dashboard, then what you watch, then
  Troubleshoot / Alerts / Reports.
- **NOC WALL left the "?" menu for ⚙ Settings**, where it is a collapsible group of its own (Alert radar · Key
  indicators) between SETTINGS and AI. `#noc` and `#noc?w=kpi` are unchanged, the group opens itself when one of
  the walls is the current page, and the "?" button no longer lights up for them.
### Removed
- **On-call view is gone from the "?" menu.** It was never its own destination: the same snapshot is the **On-call**
  tab of each Alerts page, and `#oncall` / `#fixed-oncall` still open it full screen for the on-call phone.

## [2.0.0-alpha.39] — 2026-09-16 — NOC walls, top nav: one popover at a time, sectioned business menus
### Added
- **NOC walls** under ? › NOC WALL (`nocwall.js`, permission `dashboard`): `#noc` = the Executive **alert radar**
  alone, `#noc?w=kpi` = the **North-star key indicators** alone — the same `EXECOPS.render` sections the
  Executive Dashboard draws, framed for a TV: no header / chrome, a strip with the live KSA clock and the open
  counts (total · P1 · P2 · P3 · Mobile / Fixed), refresh every 60 s, **F** = fullscreen, **Esc** / Exit wall back to
  `#exec`, a switch between the two walls, sizes in `vh`/`vw` so a 4K screen fills.
  The wall re-draws only when the payload changed (signature of the radar / KPI data), ignores `opsdatarefresh`
  and the 5-min self-refresh, so the sweep, pings and typewriter run uninterrupted.
- **Executive Dashboard no longer carries the radar** — it moved to the NOC wall; a **◉ NOC wall** button sits in
  the page header next to the executive brief.
### Fixed
- **Two menus open at once.** The Mobile / Fixed dropdowns, the ⚙ settings menu and the ? menu did not know about
  each other (the gear button stops click propagation, so the dropdown's outside-click close never fired), so a Fixed
  panel could sit on top of an open settings menu on the Executive page. They now share one `navpop` event: opening
  any of them closes the others (`navdrop.js`, `settingsmenu.js`, `helpmenu.js`).
### Changed
- **Mobile / Fixed menus are two-level menus** on the desktop and in the phone drawer (`adaptive.js` builds them from
  the plain OPERATE / EXPLORE labels; the items are the same `.navtab` buttons, so roles, routing and the tour are
  untouched). A head names the business (icon · name · tagline); OPERATE and EXPLORE are disclosure rows with a
  page count that fold with an animated height; they behave as an accordion (opening one folds the other, so the
  panel is never taller than its biggest level); the level holding the current page opens itself once per page
  change; the choice is remembered per business; a level a role cannot see disappears with its header. Items
  enter with a staggered slide each time the menu opens; folded rows are not focusable. Panel capped to the
  viewport with a thin scrollbar; rows tightened (28 px icons).

## [2.0.0-alpha.38] — 2026-09-16 — Exec radar: Fixed alerts on the face, 12-hour clock
### Fixed
- **Executive dashboard › Alert radar showed `Fixed 0 open / 0` while Fixed › Alerts had 12 open.** The radar's Fixed
  half (and the contact drill-down `/api/exec/radar/cell?biz=fixed`) read the old prod engine's evaluation log
  `sda_ops.alert_events`, never the unified console's own `fixed_*` incidents in `unified_console.alerts`; the Mobile
  queries explicitly exclude `fixed_*` keys, so those incidents were invisible to both halves. Both businesses now read
  the same `alerts` table (segment-scoped via `segment.sqlWhere`), so the radar, the Fixed "Active critical signals"
  tile and the Fixed alert feed agree with Fixed › Alerts. Fixed contacts now carry a real owner, ack SLA and MTTR.
### Changed
- **Alert radar is a 12-hour clock.** Sector = KSA clock hour (13:00 at 1 o'clock), ring = severity, one sweep = the
  last 12 hours; the current hour is marked NOW and lit, the oldest sector carries −12 h. Still-open rules that fired
  before the window are pinned into the oldest sector (dotted outer ring) so nothing open ever falls off the face, and
  "still open now" counts open incidents whenever they fired. Contract: `radar.{unit:'hour',hours,slots,cells[{slot…}]}`
  (replaces `days`/`cells[{day…}]`); shared query `execRadar.radarRows(seg)` for both producers.
- `/api/exec/radar/cell` accepts `slot=YYYY-MM-DDTHH` (+`older=1`); `open=1` no longer applies a time filter.

## [2.0.0-alpha.37] — 2026-09-14 — Vendor penalty candidate model
### Added
- **Vendors & contracts** now has a **Penalty model** tab per vendor/contract for candidate-only penalty estimates:
  eligible monthly fee, monthly cap, SLA item weights, severity weights, required evidence, exclusions, approval status,
  and capped exposure.
- Penalty rules are stored with the vendor reference catalog and remain explicitly informational until evidence,
  exclusions, commercial/legal approval, and vendor-owner sign-off are complete.

## [2.0.0-alpha.36] — 2026-09-14 — Vendor phases 4 and 5 rollout matrices
### Added
- **Vendors & contracts** now treats phases 4 and 5 as ready informational governance layers: phase 4 maps each
  contractual SLA/SLO to evidence connectors, readiness, confidence, controls, and next source-wiring steps.
- **Operational rollout** tab shows where vendor SLA evidence will surface across SLA dashboard, Yusr, incident details,
  Customer 360, Monitoring, monthly governance, and test-mail preview, with explicit gates that keep enforcement disabled
  until UAT and vendor-owner sign-off.

## [2.0.0-alpha.35] — 2026-09-14 — Vendor SLA test mail previews
### Added
- **Vendor contract SLA** now has a safe CLI mail-preview command for R1/R2/R3/repeat/management escalation formats.
  The command requires one explicit `--to` address and ignores configured team/management recipients, so tests can be
  sent only to the requester.

## [2.0.0-alpha.34] — 2026-09-14 — Vendor management escalation clarity
### Changed
- **Vendors & contracts** now labels the management recipient field as the target used by each SLA row's
  **Inform management** switch and warns when a contract has no management list configured.

## [2.0.0-alpha.33] — 2026-09-14 — Contract SLA escalation flows
### Added
- **Vendors & contracts** now has a contract-level **Escalation flow** editor for Sigma/TCS SLA items: enablement,
  reminder 1/2/3 timings, repeat cadence, management notification flags, allowed channels, and per-SLA breach messages.
- Vendor contract defaults now seed escalation flows per contract and persist edits in `console_settings.vendor_contracts`
  through the existing audited `/api/vendor-contracts` API.

### Changed
- Removed the visible **Tests / rollback** tab from **Vendors & contracts** so the page focuses on vendor reference data,
  SLA obligations, escalation configuration, assignments, and evidence mapping.

## [2.0.0-alpha.32] — 2026-09-14 — Vendor contracts dark-mode polish
### Fixed
- **Vendors & contracts** now cache-busts the page script and uses explicit theme-aware dark-mode overrides, so cards,
  phase boxes, tabs, tables, and the JSON editor stay readable in dark mode.

## [2.0.0-alpha.31] — 2026-09-14 — Vendor contracts and SLA rollout phases
### Added
- **Vendors & contracts**: new Super Admin-only page (`#vendor-contracts`) for Sigma/TCS reference details, contract
  scope, global SLA/SLO obligations, Fixed / MVNO assignments, evidence-source mapping, and the five rollout phases.
- **Vendor contract API** (`/api/vendor-contracts`) stores the reference catalog in `console_settings`, with audited save
  and reset-to-defaults operations and no schema migration.
- **Operational rollout pack** is now visible in the console with deployment checks, post-deployment test scenarios, and
  a safe rollback plan for the new vendor/SLA governance layer.

## [2.0.0-alpha.30] — 2026-09-14 — Home CTA drill-down accuracy
### Fixed
- **Home Fixed CTAs** now open the page that owns the KPI with the matching window/filter: aggregate journey KPIs go to
  Fixed Operations Dashboard, Nafath identity issues go to SDA map with 5G + failed-Nafath filters, and open error
  categories go to Fixed Troubleshoot with the exact category and 24 h open window.
- **Fixed deep links** now consume Home CTA filters on Overview, Reports, and Troubleshoot without inheriting stale local
  filters from a previous visit.
- **Hash routing** now explicitly activates the destination view even when the Fixed dropdown already marked the requested
  sub-page active, fixing `#fixed?...` URLs that updated the nav chip but left Home visible.
- **Fixed Operations Dashboard** now renders the `Recent attempts` table after the lower operations/SLO/trend content, so
  the noisy newest-100 table stays at the end of the page.

## [2.0.0-alpha.29] — 2026-09-14 — Dedicated SLO definitions page
### Changed
- **SLA** now stays focused on live attainment, vendor health, anomalies, and acknowledgement SLA.
- **SLO definitions** moved to a separate Super Admin-only page (`#slo-settings`) with a card-based Fixed / MVNO editor,
  summary counters, business tabs, and group navigation.

## [2.0.0-alpha.28] — 2026-09-14 — SLO business labels: Fixed / MVNO
### Changed
- **SLA → SLO definitions & target messages** now presents the configurable businesses as **MVNO** and **Fixed**
  instead of exposing the internal `mobile` key.
- **Executive SLO badges** now show **MVNO** for the MVNO business while preserving the existing `mobile` route/API key
  for compatibility.

## [2.0.0-alpha.27] — 2026-09-14 — Super Admin SLO target builder
### Added
- **SLA → SLO definitions & target messages**: Super Admins can now edit SLO defaults, enable/disable targets,
  tune warning bands, and define operator messages for met / near-target / breached states.
- **Shared SLO config** in `console_settings.slo_config`, mirrored back to legacy `slo_targets` for existing journey
  rollups so the old SLA calculations keep working.

### Changed
- **Executive SLO cards** for Mobile and Fixed now read their thresholds from the shared SLO config instead of hardcoded
  values; payment, activation, Nafath, error budgets, conversion, Manafith, Semati and eligibility cards now support
  green / amber / red states from the configured target and warning band.
- **SLO editing authorization** is Super Admin only and audited, including reset-to-defaults.

## [2.0.0-alpha.26] — 2026-09-13 — OSB business stories and honest correlation
### Added
- **OSB business stories** classify archive evidence into recharge/voucher, MNP, onboarding/inventory, Remedy tickets,
  billing/invoices, SADAD/payment notices, Nafath, balance/bundle reads, plan options and profile reads.
- **Monitoring → OSB** now shows business-story cards before the raw URI table, plus an explicit correlation note:
  OSB access ↔ payload can be exact by ECID, while Digital/APIGW ↔ OSB is only subscriber+time unless a shared trace id
  appears in future logs.
- **Customer 360 / Yusr** now receive OSB story summaries and a support-facing verdict, so repeated profile reads are
  explained as direct BSS evidence rather than confused with a full end-to-end journey.
### Changed
- **OSB drill-down wording** now says "OSB same-ECID rows" instead of "end-to-end hops" when the archive lacks a
  Digital/APIGW request id.

## [2.0.0-alpha.25] — 2026-09-13 — OSB drill-down and selected-line correlation
### Fixed
- **Customer 360 / Journey / Yusr OSB correlation** now resolves the searched key to the selected Salam service line
  before querying the OSB archive, so National ID searches no longer miss direct MSISDN access-log hits.
- **Yusr OSB summaries** now count direct backend hits separately from ECID-joined backend hops, avoiding the false
  “0 OSB details” wording when the archive has Siebel/UIM access rows but no pipeline payload for that call.
### Added
- **Monitoring → OSB · ORACLE BUS drill-down**: each URI row is clickable and shows sampled transactions, ECID,
  same-transaction backend hops, joined pipeline payload snippets, archive batch, and top query-string MSISDN hits.

## [2.0.0-alpha.24] — 2026-09-13 — OSB/BSS archive correlation across Yusr, Subscriber 360, timelines and dashboard
### Added
- **OSB archive batch tracking** (`osbArchive.js`): server-152 CLI can now scan SFTP upload roots, verify `.sha256`
  sidecars, safely inspect/extract `.tar.gz` archives, import unprocessed OSB batches, and record archive window,
  row counts, checksum status and import errors in `osb_archive_batches`.
- **Safer OSB parser/correlation keys**: pipeline imports now carry a stable `event_hash` so re-imports skip duplicate
  payload rows; parsers normalize `05…`, `5…` and `9665…` MSISDNs, capture ECIDs in more formats, record component,
  transaction ids and bounded identifier metadata.
- **Customer OSB summary**: one backend helper now powers Subscriber 360, Yusr and the transaction timeline with the
  same exact matching rules: payload identifier match first, ECID-joined backend hops second.
### Changed
- **Yusr AI** now receives compact OSB/BSS archive evidence for customer lookups, including archive coverage,
  pipeline/backend counts, fault kinds and recent component hits, without sending full raw payloads into the prompt.
- **Subscriber 360** OSB panel shows quick KPIs for the selected line before the raw payload/ECID table.
- **Monitoring** OSB panel now uses the real imported archive window and latest batch metadata instead of a hardcoded
  coverage note.
- **Mobile dashboard** Oracle-stack card is now labelled as BSS/OSB findings and includes fault-kind KPIs plus a small
  imported-archive daily trend.

## [2.0.0-alpha.23] — 2026-09-11 — AI budgets per user & per agent · the agents get answers again · runbook steps · activity diff
### Fixed
- **The agents never got an answer from the model** ("Agent triage (evidence only — model unavailable)" on every
  incident since they went live). `llm.chat()` built its `messages` array from `system` + `user` but passed the
  ORIGINAL options object to the provider — so every caller that used `{system, user}` (both agents) sent a request
  with **no messages field at all**, which Ollama answers with HTTP 200 and an empty string in ~250 ms. Yusr chat and
  the warm-up were never affected because they pass `messages` themselves, which is why the model looked healthy.
- **Runbook steps**: builtin runbooks are seeded as one paragraph with inline numbering ("1) … 2) …") but the incident
  checklist split on newlines only, so four steps became one checkbox — and the mails used a third, different split.
  One shared splitter (`runbook.js`) now serves the checklist, Guided Response, hand-over and reminder mails and the
  ServiceNow description; it splits on newlines and on inline numbering, never on a decimal (0.5h, v1.2).
### Added
- **AI usage & budget** (`llmBudget.js`, Settings › Agents › AI usage & budget): every model call is metered in
  TOKENS (measured when the provider reports them, otherwise estimated from characters and flagged) and attributed
  to the person who asked or to the agent service that asked. Ceilings per KSA day — per user, per agent, whole
  console per day and per month, with per-person overrides — a warning mail at 80 % and, over 100 %, a refusal that
  is never an error (Yusr answers from the rule engine, the agents write their measured-evidence note). Screen shows
  today vs ceiling, a 14-day token chart (humans vs agents), per-person and per-agent tables with editable ceilings,
  cost for a cloud/GPU fallback (on-prem reads "no external cost") and the notification log. Humans and machines are
  budgeted separately so an agent storm can never eat a person's allowance.
  API: `GET/PUT /api/llm/budget`, `GET /api/llm/usage?days&user`, `GET /api/llm/usage/mine` (any signed-in user).
  Yusr's panel shows "AI budget N %" once you pass the warning line.
- **LLM self-test** (`POST /api/llm/selftest`, button on the Agents page): five probes of growing size with the JSON
  grammar on and off, and a verdict — healthy · the grammar breaks this model · prompts stop being answered from a
  given size (context window) · the model answers nothing at all.
- **Prompt budget + empty-answer ladder** in `llm.js`: prompts are capped (`LLM_PROMPT_CHARS`, default 9 000) and
  trimmed in the middle; an empty answer escalates (grammar → no grammar → 16 k context + merged system) and, if
  every attempt is empty, throws a diagnosis recorded in `llm_calls` instead of a silent "".
- **Alerts › Activity log**: the Detail column is a git-style diff (field · old in red · new in green; long values as
  −/+ blocks). Rule edits use their field history; configuration saves are diffed against the previous save of the
  same action, since `audit_log` keeps only the value that was saved. Checklist / cases-preview / export / resolve
  rows now read in plain language instead of raw JSON, and cases/notify rows link to their incident.
- **Alerts › Open**: owner column is a person card — name, e-mail, role · team, time-to-ack against the severity SLA,
  holding time, assignee, and the holder's live load (open held · acked 24 h · avg ack 7 d). Action column reduced to
  one primary action per state plus a grouped ⋯ menu (ownership · escalate · timing · close).

## [2.0.0-alpha.22] — 2026-09-11 — Impact counting (unique customers / services) · rule editor drawer · L1/L2 journey
### Added
- **Impact counting** (`identity.js`): every metric with a customer behind its rows (payments, activations, Semati,
  Nafath, eligibility, plan changes, deliveries, onboarding, OTP — 35 of 60 metrics) now also reports **distinct
  customers and services** at each sync (`metric_snapshots.customers/customers_total/services/services_total`),
  computed on exactly the same rows the metric and the "Affected cases" export describe (reuses the alertCases twins).
  Only the rows an enabled rule needs are counted — no extra replica load for rules that keep the classic behaviour.
- **Rule options**: `count_by` = events | unique customers | unique services (the value becomes the distinct count,
  or customers hit ÷ customers seen for a rate); **customer floor** `min_customers` with `single_customer_severity`
  (default P4) — a rule whose condition is met by fewer distinct customers than the floor fires at the floor severity
  ("1 customer, 13 attempts → P4"), and goes back to its declared severity on a later tick when more customers appear
  (severity change written on the incident). Existing rules are untouched (`events`, floor off).
- **Incidents carry impact**: `alerts.customers / services / rule_severity`; the message and the digest mail say
  "N customers (M attempts)" and flag a downgrade; the Open list shows an Impact column with a purple **1 customer** chip.
- **Rule editor drawer** (replaces the modal): five sections — What · Condition · Impact · Routing · Runbook — with a
  live 7-day sparkline (threshold in the rule's severity colour, breaches as dots) and **Test now** on the replica:
  current value, customers/services hit, "would fire at P4 (rule says P2)", and how many of the last 7 days'
  evaluations would have fired / been downgraded. Metrics without a customer identity have the option greyed out
  with the reason. API: `POST /api/rules/preview`, `GET /api/rules/identity`, `GET /api/metrics/series?dim&days`.
- **Rules list**: search, severity / team / enabled / count-by filters, "Noisy" toggle, 7-day badges per rule
  (fired · acked · single-customer · noise · open), severity edge colour.
- **Open alerts (See → Own)**: quick filters All · Unacked · Mine · My team · 1 customer + severity chips + search;
  unacknowledged incidents first within a severity; severity edge colour; **Assign to me**; **one-click acknowledge
  from the mail** (`#alerts?id=N&ack=1` on digest and reminder links — acknowledges for the signed-in reader, once).
- **Work**: incident details now show one merged **timeline** (fired, agent triage, ack / handover / reminders,
  ServiceNow, comms, comments, rule edits during the incident, severity moves, resolved) and the runbook as a
  **persistent checklist** (who ticked which step, when — `incident_checklist`, audited `incident.checklist`).
  API: `GET /api/alerts/:id/timeline`, `GET/POST /api/alerts/:id/checklist`.
- **Close**: Resolve asks for a reason — fixed · single customer / retry storm · false positive · duplicate ·
  maintenance (+ note); recorded as `alerts.resolve_reason / resolved_by`, on the discussion and in the audit.
  Auto-resolution by the runner records `cleared / system`.
- **Learn — Alerts › Noise tab** (`GET /api/alerts/noise?segment&days`): per-rule scorecard — fired, acked %, MTTA,
  single-customer share, downgraded by floor, closed-as breakdown, re-opens — with a verdict (noisy · retry storms ·
  ignored · healthy · quiet) and a concrete hint (raise threshold, set a floor, count by customers, re-route).
### Changed
- `alertRunner.evaluate()` returns `customers`, `services`, `counted`, `count_by`, `rule_severity`, `downgraded`;
  the digest intro line shows the customer count and downgrades.
- `PATCH/POST /api/rules` validate `count_by / min_customers / single_customer_severity` and refuse them on metrics
  without identity; rule change history records the new fields like any other.

## [2.0.0-alpha.21] — 2026-09-11 — Activity log (who did what) · rule change history · reminder-1 fix
### Added
- **Alerts › Activity log** (`alertActivity.js`, new tab): every CONSOLE-USER action on alerting, in plain words —
  on incidents (acknowledge, take over, hand over + note, assign, snooze, resolve, ServiceNow create/link/note,
  customer comms, notify), on rules (create, edit with the exact `field: old → new`, enable/disable, re-seed) and on
  the configuration (acknowledgement SLA ladder, flap control, anomaly engine, latency thresholds, escalation,
  gateways, AI-agent policy). Filters by user / kind / period / free text, per-user tiles, links back to the incident
  or the rule's history, and an XLSX export with a per-user summary sheet (`alert.activity.export`, audited).
  API: `GET /api/alerts/activity?segment&days&user&action&q[&format=xlsx]`.
- **Alert rule change history**: every save, enable/disable and new rule is recorded field by field (before → after,
  who, when KSA) in `alert_rule_changes`. Shown in the rule's History modal ("Change history"), as a "Last changed by …"
  line at the top of the Edit dialog, and as a "Rule change history" feed at the bottom of Alerts › Alert rules
  (per business). API: `GET /api/rules/changes?segment&limit`, `edits`/`lastEdit` on `GET /api/rules/:id/history`.
- Healthcheck "shared server saturation" now lists the top connection holders (user@client · app · idle age) and the
  number of pgAdmin sessions — needs `pg_read_all_stats` on the console role (granted on 121, 10 Sep).
- `sql.cjs --csv <file>` export.
### Fixed
- **Acknowledgement reminder 1 never sent since 9 Sep 09:52** ("not sent · 0 (0)"): the audience query for R1 bound a
  parameter it did not use → Postgres error swallowed → empty audience. Business filter now always in the query; the
  fallback to the Mail-alert audience works for R1 as designed; audience errors are logged.
- Healthcheck CRIT mails: on change, then every `HC_CRIT_THROTTLE_MIN` (30) — not every 5-minute run.
- Daily agent report goes to super admins only (or `AGENT_REPORT_TO`).
- Agent 1 signature upsert type clash; LLM layer retries without `format=json` on empty Ollama answers.

## [2.0.0-alpha.20] — 2026-09-10 — AI agents (on-prem, separate PM2 services) + LLM layer with failover
### Added
- **`server/src/llm.js`** — the one LLM layer for Yusr and the agents. PRIMARY (Ollama on 152 today) + optional FALLBACK
  (any OpenAI-compatible on-prem engine: vLLM on a GPU VM, llama.cpp server, a second Ollama). Automatic failover on
  timeout / 5xx / connection error, JSON mode, health probe every 60 s, every call audited in `llm_calls`. Config from
  `.env` (`LLM_PRIMARY_*`, `LLM_FALLBACK_*`, defaults to `OLLAMA_URL/OLLAMA_MODEL` and Yusr's settings) or Settings › Agents.
- **Agent 1 — log intelligence** (`server/src/agentLog.js`, PM2 `salam-agent-log`): every 15 min folds new
  `api_error_events` + technical `api_traffic_events` into signatures (`agent_signatures`: masked pattern, counts,
  hosts, sample), asks the model only about NEW signatures (category, business/technical, severity hint, probable
  cause, owner team, runbook, confidence), daily report at 06:00 KSA (`agent_reports` + mail with XLSX to **super admins only**,
  or `AGENT_REPORT_TO`). Review workflow (new → reviewed / known / ignored / ticketed) in Settings › Agents.
- **Agent 2 — incident operations** (`server/src/agentIncident.js`, PM2 `salam-agent-incident`): every 3 min every
  open incident without a triage note gets one — deterministic evidence first (duplicate of an open incident of the
  same rule, flapping, 30-day history and median lifetime, what fired ±10 min, busiest signatures now), then one model
  call → probable cause, impact, suggested team, first action, priority hint, confidence. Stored in `agent_triage`
  and posted as an `agent` comment on the incident (visible in the drawer, the history XLSX and reminder mails).
  Policy (`agent_incident` setting): **advise** (default, notes only) or **assist** with per-rule allow-lists
  (auto-set owner team when empty · auto-resolve exact duplicates). Acknowledge / close / escalate stay human + SLA ladder.
- **Settings › Agents** (`agents.js`, `#agents`, super-admin root tier): LLM primary/fallback cards with health,
  configure + probe + test call, agent liveness KPIs, tabs Signatures (filters, review drawer), Triage notes (👍/👎
  feedback), Daily reports, Policy, LLM calls; "run now" buttons for both agents and the daily report.
- REST `agentsApi.js`: `/api/llm/{status,probe,config,test,calls}`, `/api/agents/{overview,signatures,reports,triage,policy,run/:agent}`.
- PM2 ecosystem gains `salam-agent-log` and `salam-agent-incident` (same `.env`); `deploy.sh` restarts them with the console.
### Changed
- Yusr (`assist.js`) now calls `llm.chat` (same prompt layout and CPU-tuned options) — it inherits failover and audit;
  `ping()` reports the fallback state too.

## [2.0.0-alpha.19] — 2026-09-10 — Acknowledgement SLA: reminders 1 / 2 / 3 + management escalation
### Added
- **Acknowledgement SLA** (`server/src/ackSla.js`, `acksla.js`). L1 already receives every alert by mail with the SOP the
  moment it fires; this is the safety net for the alert **nobody on L1 / L2 acknowledges**. Wall-clock from the moment the
  alert opened (`alerts.opened_wall`, never the sim clock): **Reminder 1** (notice) to every member of the business,
  **Reminder 2** (warning — also posted to that business's Teams / WhatsApp channels when ChatOps is on), **Reminder 3**
  (critical) plus a **separate for-information mail to management**, then Reminder 3 repeats every N minutes until
  someone presses Ack. Defaults: P1 5 / 15 / 30 min, repeat 30; P2 15 / 30 / 60, repeat 60; P3 30 / 60 / 120, no
  management step. Audience follows the **ACK holder** flags of the users list (`ack_mobile` / `ack_fixed`): Reminder 1
  goes to the ack holders of that side only (the people who can press Ack); Reminders 2 and 3 add every other member of
  that side with Alert mail on. Reminders stop on Ack / Snooze / Resolve; correlated children under an open root are not reminded
  separately. Every send is a system comment on the incident, an `incident.reminder` audit row and a row in the new
  `alert_reminders` table (level, recipients, management, channels, outcome). Team mails go Bcc through the existing
  bulk sender; the management mail is a distinct template (no action expected) and never exposes the team list.
- **Configurable in Settings › SLA › "Acknowledgement SLA"**: master switch, then two cards — **Mobile** and **Fixed** —
  each with the per-priority ladder (R1 / R2 / R3 minutes, repeat interval, "inform management" per priority), the
  management contacts, the ChatOps toggle, **✉ R1 / R2 / R3 preview** mails to yourself (real open alert of that side
  or a sample), the live list of unacknowledged alerts with their next due step, **▷ Run check now**, and the last
  reminders sent. Validation keeps the ladder increasing; 0 disables a step.
- **Reflected on the dashboards**: a notice / warning / critical banner on the home page (under GLOBAL STATUS) and on
  each Alerts page — "N Mobile alerts unacknowledged beyond SLA — worst P1 … open 34 min · Reminder 3 sent · next
  repeat in 12 min", colour by level, click opens the incident — and a **⏰ R2 · 17 min** chip in the STATUS cell of the
  alert row (🚨 at R3). `GET /api/ack-sla/status?segment=` feeds them (own side(s) only).
- Management contacts are picked from the **users list** (chips + autocomplete on name / email / team, ↑↓ Enter, Backspace
  removes; an address outside the console can still be typed) — one picker per business. `GET /api/ack-sla/people`.
- **Latency alerting configuration moved** from Monitoring › Gateway to **Mobile › Alerts › Alert rules › Latency thresholds**
  (last section; `latencycfg.js`): global p95, manual per-API overrides and the per-API lines from history all live with
  the other alert configuration. Monitoring › Gateway keeps a one-line summary with a "Configure…" link
  (`#alerts?tab=rules&sec=latency`); `#alerts?tab=<open|all|rules|metrics|oncall>` now forces that sub-tab.
- **Flap control** (`alertRunner.js`, settings key `alert_flap`, Settings › SLA › Flap control): measured 5–9 Sep on Mobile —
  872 incident rows in 4 days for 40 rules, the payment failure storm alone re-opened 257 times because every threshold
  crossing was a new incident (new mail, new page, new row to acknowledge). Now a rule that fires again within
  `reopenMin` (60) of its last incident resolving **re-opens that incident** (ack / owner / discussion kept,
  `breach_count`++, new `alerts.reopen_count`++, system comment, no new mail), and an open incident resolves only after
  the condition has been clear for `clearHoldMin` (15). Both editable without restart.
- **⬇ History XLSX** on both Alerts pages (`alertHistory.js`, cap export, audited): every incident of the business over N days
  with Summary per rule (incidents, breaches, re-opens, ack %, median minutes to ack, reminders), Incidents, Updates
  (incident timeline), Audit and Reminders sheets — the evidence pack for the SLA reviews. `GET /api/alerts/history`.
- **User management, redesigned** (`usersmgmt.js`): a KPI strip (users, seen 7 d, never signed in, blocked, Mobile /
  Fixed, ACK holders per side, mail alert / report, acks 30 d, super admins — click a KPI to filter), a multi-criteria
  filter bar (free search on name / e-mail / team / mobile / role / tag, business, status, ACK holder, mail, roles,
  tags, sort), a compact people table (avatar, roles as chips, inline switches for mail alert / report and ACK
  Mobile / Fixed, 30-day activity: actions, acks, MTTA, last action), selection + **bulk actions** (ACK holder,
  mail flags, business, block / unblock), "New user" as a drawer, CSV export. `GET /api/users` now returns
  `activity` per user. **The L2 Workbench moved to the bottom of this page** (`#workbench` opens Settings › Users and
  scrolls to it), so every console-user topic — accounts, roles, permissions, PII, activity, replay, tests, docs — is
  one page.
- API: `GET/PUT /api/ack-sla` (manageSync), `GET/PUT /api/alert-flap`, `GET /api/ack-sla/status`, `POST /api/ack-sla/preview`, `POST /api/ack-sla/tick`.
  Schema: `alerts.ack_reminder_level`, `alerts.ack_reminder_at`, table `alert_reminders` (self-seeded at boot).

## [2.0.0-alpha.18] — 2026-09-08 — Fixed › Errors: every channel, with Channel and Type
### Changed
- **Fixed › Errors covers all four Fixed channels** — SDA dealer app, QR codes, **Web e-purchase (consumer-direct)** and
  the **Salam Home app** — instead of SDA + QR only. The board now reads the two read models of the same nexus stream
  and partitions them so nothing is counted twice and nothing is hidden: SDA + QR from prod `sda_ops` (whose ingest
  still folds the app's PULSE channel into referral-less e-purchase — the reason "consumer-direct" used to be excluded),
  Web + Salam Home app from `sda_ops_beta` (PULSE → `salamhome`, consumer-direct stored, salamHome* journeys mapped).
  Without `OPS_BETA_DATABASE_URL` every channel is read from `sda_ops`. Summary, live rows, escalation counts
  (last-3h), detail, similar cases, api_calls and exports all follow the row's own source (`src`).
- **Two new columns** on the board: **Channel** (SDA · QR code · Web e-purchase · Salam Home app) and **Type**
  (FTTH · FTTB · 5G HomeFi · 5G FWA · 5G (plan) · Lead · Unknown), the type derived from the attempt's workflow
  (`ftth` / `ePurchaseFTTH` / `salamHomeRelocationFTTH` → FTTH, `fttb` → FTTB, `fiveGWhiteLabel` / relocation WL·Own →
  5G HomeFi, `fiveGFWA` → 5G FWA, `promoters` → Lead) then from the plan text; Salam Home journeys also show what the
  customer was doing (Relocation · Freeze · Change plan · Renew …). Dealer / QR cell reads "consumer-direct" (web) or
  "customer (app)" instead of "unattributed".
- **Two new chip rows** — **Channel** and **Type** — under Provider, counted like the provider chips (a chip keeps its
  number while it is selected; other filters still apply). The channel `<select>` is gone; the hub's channel chip is
  still honoured (`epurchase` = QR + Web). `?channel=sda|qr|web|salamhome&type=…` on every errors API.
- Source freshness on the board: "SDA · QR code ← sda_ops · last event 4m ago · Web e-purchase · Salam Home app ←
  sda_ops_beta · last event 2m ago" — red when a read model is silent for > 2 h or unreachable, so a stalled watcher
  is visible where the team looks, not only in the healthcheck mail.
- Exports (XLSX / PDF) carry Channel, Type, Journey and Workflow columns plus by-channel / by-type summaries; filters
  block lists Channel and Type.
- Live paging cursor is now the timestamp of the last row (sources are merged), `OPS_BETA_POOL_MAX` (2) for the beta
  pool. Phone: the table scrolls sideways, an opened row's detail stays pinned to the screen.
- Anomaly engine: **no new anomaly / gateway-down alert while the source is behind** (newest payments row older than
  `anomaly.staleGateMin`, default 60 min). A lagging upstream replica empties the newest hours of our copy, so every
  volume reads "down" and every rate is computed on a truncated tail — the 8 Sep 6 h lag opened two P1s and three
  anomalies that were all artefacts. Open alerts are left to resolve on the next fresh scan; the log says
  `[anomaly] source is Nm behind — paused`.
- **Mobile ↔ Fixed segregation of alerts** (`server/src/segment.js`, one definition): a rule / firing is Fixed when
  `alert_rules.segment='fixed'` or its key starts with `fixed_` (schema backfills the column at boot). The Mobile
  endpoints — `/api/rules`, `/api/alerts`, `/api/alerts/summary`, `/api/incidents/stats` — now answer for **mvno
  only** (`?segment=fixed|all` allowed for 'both' users; a Fixed-only user gets Fixed, a Mobile-only user Mobile);
  Fixed › Alerts keeps `/api/fixed/alerts/*`. The Mobile Alerts header says "MOBILE · MVNO". Before, a Fixed rule
  (`fixed_error_p0p1_categories`) sat in the Mobile list and was acked by the Mobile team.
- **Fixed › Alerts is now the full incident view** — the same UI as Mobile (P1/P2/P3 tiles, open / unacked / MTTA /
  MTTR, Technical / Business chips, Guide, Details with runbook + discussion, Ack, Snooze, Resolve, History, **Metric
  charts** with baselines, Alert rules editor) at `#fixed-alerts`, served by the shared engine scoped to `segment=fixed`
  (`alertsview.js` is segment-aware: `openAlerts('fixed'|'mvno')`; header pill FIXED · FTTH · 5G · APP; the Mobile-only
  anomaly / error-class tabs hide). The Fixed nav item opens it; the previous rules / history / prod-engine page stays
  one link away (`#fixed?tab=alerts`). Per-id routes (`/api/alerts/:id/*`, `/api/rules/:id`) refuse an alert or rule of
  the other business for a single-business user; the Fixed-team API allow-list gained alerts / incidents / rules /
  metrics series (all segment-scoped).
- **Ack ownership can change hands — tracked.** On an acked incident (Mobile and Fixed): **Re-ack** takes the
  acknowledgement over from the current holder; **Hand over** gives it to a colleague picked from the people who may
  hold an ack on that side (`/api/alerts/holders?segment=`), with an optional note; the handed-to person also becomes
  the assignee. Every change is written as an *ownership* line in Details › Discussion ("Ack handed over: a → b by c —
  note") and audited (`incident.ack` / `incident.reack` / `incident.handover`). `ack_at` keeps the first ack so MTTA
  stays honest. The "N RULES" stat now counts the segment's rules.
- **Ack holders are explicit.** Settings → Users has two new columns, **ACK · MOBILE** and **ACK · FIXED** — who may
  take or receive an incident hand-over on each side (`console_users.ack_mobile / ack_fixed`, seeded once from
  Mail-alert + business, then admin-managed; a Mobile-only account cannot be a Fixed holder and vice versa). The
  hand-over picker lists only these people and the API refuses a hand-over to anyone else.
- **Home › My incidents.** A reminder list of the open incidents I acknowledged or was handed (both businesses, per my
  scope): severity, name, side, role (acked / assigned), fired N ago, **time in my hands** (since the last ownership
  change), ack delay vs the ack target (P1 15 m · P2 60 m · P3 4 h), and the **SLA clock** — time left of the
  resolution target (P1 4 h · P2 24 h · P3 72 h, `SLA_P1_H…` in .env) or "overdue by …", rows tinted when over.
  Each row deep-links to the incident on the right side. `GET /api/incidents/mine`.
- **Per-API latency thresholds from history are back** (`server/src/apiLatencyBaseline.js`, Monitoring › Gateway ›
  Latency alerting › *Per-API thresholds from history*). The migration kept only the global p95 line, so every API
  was judged against one number. Now a daily roll-up (`api_traffic_daily`: path × KSA day, calls, avg, p50 / p95 /
  p99, technical fails; kept 400 days, backfilled from the 7-day event table at first boot, refreshed every 6 h)
  feeds a suggestion for the **top-N APIs by calls** over a lookback (3 / 7 / 14 / 30 days): threshold = the API's
  baseline p95 (median of its daily p95s) × multiplier (default 2), never below a floor (default 1 000 ms), rounded up
  to 50 ms. *Preview* shows calls, avg, baseline p95, max p95, technical fails, the current line and its source, and
  the suggestion; *Apply* writes them as `perApiAuto` (audited `monitoring.latency_baseline.apply`); *recalibrate
  automatically* re-applies after every roll-up so each line follows its API's own normal. Manual overrides are kept
  separately and always win; `latencyThresholds()` merges auto under manual, so the rules, the per-API health table
  and the alert-cases export all use the same effective line. Saving the manual form no longer wipes the auto set.
- **Affected cases — whole population, unmasked, latency covered (9 Sep, second pass).** The export now holds
  the WHOLE population the metric evaluated (for "Nafath failure rate 0.51 (n=47)": all 47 requests) with a
  **Counted** flag on the numerator rows (the 24 failures) — counted rows first, ● marker and red tint in the preview
  and PDF, a "Counted only" toggle in the preview, population and counted with the exact percentage in the Alert
  sheet. Identities are **not masked** in this section (decision: L1/L2 already work with them) and every preview
  (`alert.cases.view`) and file (`alert.cases.export`) is audited with actor, alert, population and counted.
  `api_latency_p95` and `api_technical_fail_rate` are now row-based when the API-traffic collector is on: every call
  of the API in the window, counted = slower than the API's threshold (Settings → API latency) or technical failure,
  slowest first, with code / message / class / host / transaction id. XLSX cap raised to 10 000 rows.
- **Affected cases behind an alert — preview · XLSX · PDF, exact to the metric** (`server/src/alertCases.js`,
  `GET /api/alerts/:id/cases?format=json|xlsx|pdf&at=last|first`, cap `export` for files, audited
  `alert.cases.export`). In the guided-response box of every alert (Mobile and Fixed) three new actions list the
  rows the metric actually counted when the rule fired: the NUMERATOR of the metric's own SQL inside
  `[last_seen_at − window, last_seen_at]` (or the first firing with `at=first`), with the same table, predicate and
  dimension filter as `metrics.js` / `fixedMetrics.js` — 50 metrics covered (payments, gateways, stuck / duplicate,
  Nafath, Semati family, activation / BSS / SOAP 1500 / dominant code, eligibility, onboarding, plan change,
  ownership, delivery, app error log, OTP; Fixed: P0/P1 error categories, timeout dealers, Nafath / Semati 5G,
  Manafith, conversion drop, off-hours SDA, stagnating dealers, incident tickets). Rate metrics report the
  denominator; count metrics list exactly the counted rows; the 10 aggregate / probe metrics say so instead of
  guessing. `metrics.js` now exports its shared SQL fragments so both sides stay one definition. PII masked as on
  the board; XLSX up to 5 000 rows (+ an Alert sheet with rule, window, dimension, denominator), PDF up to 400.
- **Payment gateway registry — enabling / disabling a gateway is now one audited toggle** (`server/src/gateways.js`,
  Mobile › Alerts › Alert rules › *Payment gateways*, `GET/PUT /api/gateways`). Since UPG and Tap were switched off
  on 3 Sep 16:27 KSA the console kept treating them as live: `upg_hard_down` opened P1s, the seasonal per-gateway
  drop detector paged "UPG down" hourly, Troubleshoot offered ⇄ UPG on HyperPay rows, and the HyperPay watch relied
  on a hard-coded cutover. The registry (settings key `gateways`, seeded UPG/Tap OFF · HyperPay ON since the cutover)
  now drives all of it: rules whose `dim.gateway` / `dim.vendor` is a disabled gateway are **paused** (⏸ chip in the
  rules list, "paused — UPG gateway disabled since …" in the evaluation, open alerts resolve on the next tick and
  are auto-resolved with a system comment the moment a gateway is switched off); the anomaly drop detector skips
  disabled vendors; the HyperPay cutover clamp reads `since` of the enabled gateway (env `HYPERPAY_CUTOVER` stays
  the fallback); Troubleshoot shows ⇄ UPG only on UPG rows and only while UPG is enabled, the deep-dive header
  names the live gateway(s) and marks disabled ones "· OFF"; the Health self-check reports the registry and warns
  when the data disagrees (payments still arriving on a "disabled" gateway, or none on an "enabled" one). The
  settings card shows per gateway: state, since/by, traffic in 24 h + last success from the replica, the rules it
  pauses, open alerts, a note.
- **Troubleshoot export — analysed PDF + complete XLSX, exactly as filtered** (`server/src/errorsExport.js`,
  `GET /api/errors/export?format=xlsx|pdf`, cap `export`, audited `errors.export`). Same idea as Fixed › Errors:
  window / pinned range end, team, category, Business/Technical class, decline code, gateway and search all
  apply. XLSX = *Failures* (every row up to 5 000: time, category, class, reason, team, identifier, mobile,
  gateway, detail, order, gateway ref) + *Summary* (filters, totals with Business/Technical split, by category, by
  team, payment decline codes with share, declines by gateway, rows by gateway, gateway registry). PDF = the
  analysed report with the same sections and up to 400 rows (technical rows in red). PII masked as on the board
  unless the exporting role holds `unmaskPII`. The old client-side "⤓ Export" (120 visible rows to CSV) is replaced
  by **⬇ XLSX** / **⬇ PDF** beside the title.
- **On-call snapshot per business.** The phone-sized on-call page (`#oncall`) now exists for both teams and sits as an
  **◔ On-call** tab under each Alerts page: Mobile › Alerts › On-call (`#oncall` — /api/noc status, payment /
  activation success, errors today, orders, Mobile incidents, anomalies, freshness) and Fixed › Alerts › On-call
  (`#fixed-oncall` — status derived from the open Fixed alerts, attempts 24 h, conversion, Nafath fail rate, open
  errors across all channels, Fixed incidents with ack holder and INC chip, top error categories, watcher freshness).
  Incident rows deep-link to the incident (`?id=`); the tab shows the share link for the on-call phone; the help-menu
  entry opens the Fixed snapshot for Fixed-only users.
- **Customer 360 › Fixed: complaint tickets from the Salam Home app.** A new card lists the complaints the customer
  opened in the app (nexus `tickets`, joined to `users` by the ticket's phone number, the app user's phone number or
  the national id): opened, ticket id, type, status (open in red, resolved green), description, masked contact —
  header count in the Fixed summary line. The app posts these to the call-centre ticketing behind the SDM gateway
  (Remedy-style categories, support group "Back Office" / ITC) and mirrors id + status; a review of salam-nexus
  master found no other ITSM (ServiceNow / Remedy) integration in the digital backend. Read-only, 8 s timeout,
  matched by mobile number or national id only.
- **ServiceNow tickets from the console — Phase 1 (manual, after ack)** (`server/src/snTicket.js`,
  docs/SERVICENOW-INTEGRATION-PLAN.md). On an acknowledged incident (Mobile and Fixed views) the ack holder — or any
  ACK · MOBILE / ACK · FIXED holder, or an ops admin — gets **🎫 ServiceNow**: the console pre-fills the INC (short
  description, full description with metric / observed / runbook / console link, impact × urgency from the severity,
  assignment group per business, category), the person reviews and confirms → `POST /api/now/table/incident`.
  One INC per incident (`correlation_id ops-console:<id>`, a retry re-links instead of duplicating); `sn_number /
  sn_sys_id / sn_state` stored on the alert, a system comment and an audit row (`incident.servicenow.create`), the
  row shows a **🎫 INC… · state** chip that opens the ticket panel with a link to ServiceHub, a work-note / comment
  box (`PATCH work_notes|comments`, `incident.servicenow.note`) and **↻ Refresh state**. A poller (every `SN_SYNC_MIN`,
  default 3) refreshes state / assignee of every open linked INC and writes state changes into the discussion.
  **Dry run by default**: until Settings → Notifications → ServiceNow → *Ticket creation enabled* is ticked (or while
  `SN_USER / SN_PASS` are empty) the button shows the exact payload and sends nothing — so the account can be dropped
  in and the mapping tested without opening tickets. Settings also hold the assignment groups per business, category
  / subcategory, caller mode, plus *Test connection*, *List groups*, *List categories* (read from the instance).
  Health self-check line "ServiceNow" reports connection · write mode · groups · linked incidents · poller.
- **Incident comms mail from the console.** **✉ Comms** on an acknowledged incident opens the L1 "Critical Incident
  Notification" pre-filled — priority, ticket number (linked INC), reported date/time, issue description, business /
  service impact, impacted service, status update, bridge link — with the recipients from Settings → Notifications →
  *Incident comms* (per business × P1 / P2 / P3, standing bridge link, signature). Preview renders the mail inline;
  Send goes Bcc, is logged in `incident_comms` and on the incident, mirrored as a ServiceNow work note when linked;
  **Status update** and **Resolved** reuse the template (subject `P1-<title>`, `- Update`, `- Resolved`).
- **ChatOps per business — separate Teams / Slack / WhatsApp / SMS channels for Fixed.** Settings → Notifications has a
  new **Fixed business channels** block (`chatops.fixed = { teamsUrl, slackUrl, waTo, smsTo }`): a Fixed alert
  (`segment.js` → fixed) is pushed **only** to the Fixed Teams workflow / Slack webhook / WhatsApp recipients / SMS
  recipients, a Mobile alert only to the existing (Mobile) ones — neither side falls back to the other, an empty side
  simply logs `dev/no-channel · Fixed`. Same payloads (Adaptive Card / blocks / template), the WhatsApp sender, token,
  template and relay are shared (one business number, two recipient lists). Every message now carries the business
  (`P1 · Fixed · <name>`, a *Business* fact on the card) and deep-links to the right incident view
  (`#fixed-alerts?id=N` / `#alerts?id=N` — the `?incident=` links ChatOps used before were not understood by the page).
  "Send test" has a **Mobile channels / Fixed channels** selector (`POST /api/chatops/test {segment:'fixed'}`), the
  Health self-check lists channels per side (`Mobile: Teams · WhatsApp · Fixed: Teams`) and warns while one side has
  none, and the digest mail's Fixed rows now open the Fixed incident view instead of the legacy Fixed › Alerts tab.
- **Fixed incident guide → Fixed › Errors.** On `#fixed-alerts` the guide's "Open in Troubleshoot" button is
  "Open Fixed › Errors" (`#fixed?tab=errors`, all four channels); Mobile keeps the MVNO Troubleshoot board.
- **Hand-over mail.** When an ack changes hands the new holder receives one mail in the alert template focused on that
  incident — who handed it and why (note), observed vs threshold, fired / last seen / breaches, team, metric, the
  rule's runbook as numbered steps, a deep link straight to the incident on the right side (`#alerts?id=` /
  `#fixed-alerts?id=`), Inspect link for Fixed rules, and the same PDF report the digest attaches. The previous holder
  gets a short "ack moved to …" notice (no PDF). Re-ack notifies the person who lost the ack. Best-effort, never
  blocks the action; `mailed` in the API response says what went out.
- **Two alert mails, one per business.** The digest is split by segment: `[Salam Ops · Fixed] N alert(s)` and
  `[Salam Ops · Mobile] N alert(s)`, each with its own intro, table, PDFs and console links. Recipients = users with
  Mail alert ON **whose business covers that side** (`console_users.business`: fixed → Fixed mail, mobile → Mobile
  mail, both → both). A side with nothing firing sends nothing. Test mail (Settings / `cli.js testmail`) sends the
  side(s) that contain the simulated rule.
- Fixed › Errors: **several rows can be open at once** — each row toggles on its own (no accordion), so two cases can be
  compared side by side; a "Collapse N open rows" button appears once two or more are open; open rows survive the
  60 s refresh. "Similar cases · median resolve" ignores rows whose resolved_at precedes occurred_at (it showed −79 m).
- Fixed › Errors partition is **data-driven**: `sda_ops_beta` serves Web + Salam Home app only while its newest event is
  within `OPS_BETA_STALE_MIN` (120) of prod's; otherwise every channel comes from `sda_ops` and the board says so
  (the beta watcher had been silent since 22 Aug — a config-only partition would have shown "Web · 0" against 1 266
  real rows). Re-checked every 60 s, logged on change.
- Response cache: marked stale after every prod-sync run that imports rows (dashboards recompute instead of serving
  pre-sync figures for another TTL); the on-disk snapshot is restored only when younger than
  `RESP_CACHE_RESTORE_MAX_MIN` (30) — an old snapshot served zero-filled tiles after the replica outage.
- Health self-check: "Alert engine · no snapshots yet" was a bug in the probe (it read `metric_snapshots.created_at`;
  the column is `computed_at`) — it now reports the real age of the last evaluation. ChatOps shows grey/optional when
  it is switched off with nothing configured; amber only when enabled-but-empty or configured-but-off.
- Fixed › Diagrams on prod: the four iframe pages (`fixed-diagrams/*.html` + mermaid) were never in the deploy bundle
  ("Cannot GET /fixed-diagrams/salam-journeys-explorer.html") — `deploy.sh` now ships the folder like `assets/`.
- Healthcheck: "console connections" warn / crit now default to the console's own pool budget (+2 / +8, computed from the
  db.js pool maxes and the configured sources) instead of the donor's fixed 12 / 18 — every unified pool shares one role
  on 121, so 12 was below normal load and flapped; the local-replica probe uses the same budget (same server, same role).
- Verified on a local Postgres with two databases seeded to mirror prod (PULSE folded) and beta (mapped): 9 events →
  4 SDA · 1 QR · 1 Web · 3 app, types FTTH 5 / FTTB 1 / 5G HomeFi 1 / 5G 1 / Lead 1, no duplicate for the same
  event id, cursor paging, legacy `channel=epurchase`, detail via `src`, XLSX + PDF; single-source fallback.

## [2.0.0-alpha.17] — 2026-09-07 — Demo mode: record once, replay instantly
### Added
- **Settings → Demo mode** (`democfg.js`, `#settings-demo`, cap `manageSync`) — record-and-replay at the API boundary
  (`server/src/demo.js`). **Record**: browse the demo path once, every JSON response the pages fetch is stored in a
  named set (`demo_sets` / `demo_snapshots`, console DB only). **Replay**: pages answer from the set in ~1 ms — no
  replica, OPS pool, SSH or LLM — with timestamps shifted to now (ISO, `YYYY-MM-DD HH:MM:SS`, epoch-ms; date-only by
  whole days); anything not recorded falls through to live. **Per signed-in user** (`demo_users`): nobody else is
  affected. Writes in replay never reach a handler — a recorded answer or "Demo mode — nothing was changed". Yusr:
  recorded questions (normalised text) answer instantly, new ones go to the live model. Coverage checklist per demo
  surface, export / import of a set as JSON, a violet dot on the ⚙ gear while replaying (red blinking while recording).
- **Cache warm-up after deploy**: the set marked ★ is replayed against the server itself 20 s after boot (loopback
  auth + `X-Demo-Bypass`, so real handlers run and `respCache` fills) — the first Home paint after a restart is fast
  for everyone. `DEMO_WARMUP=0` disables; Settings → Demo has "Warm cache now".
- Verified end-to-end on a local Postgres with a mini Express app: record → replay (5 ms), time shift, Yusr match,
  write guard, live fallback, per-user isolation, export.
- **Prod-safety healthcheck mail** (`server/src/prodHealth.js`) — the Fixed ops console's `ops-healthcheck` cron, ported
  in-process and widened to the unified footprint: console-role connections + shared-server saturation on the console
  Postgres (and the ops server when different), read load on the selfcare replica and Nexus, box CPU / memory / disk,
  Fixed ingest freshness, Mobile sync age. Every `HEALTHCHECK_INTERVAL_MIN` (5); recipients `HEALTHCHECK_EMAILS`;
  CRIT every run, WARN on change / throttle, OK as recovery notice, `HEALTHCHECK_ALWAYS=1` for the old every-run
  behaviour. Laid out like the Sync Health mail — status line, key/value block, one table row per probe (colour by
  level) — plain-text alternative kept. `node src/cli.js healthcheck [--always|--print]`.
- **Bulk mails never expose the list**: any mail with more than one recipient goes To = the console's own address with
  everyone in **Bcc** (`MAIL_BULK_MODE=bcc`, default) or as one personal message per recipient (`MAIL_BULK_MODE=individual`).
  Single-recipient mails (OTP, ticket updates) unchanged.
- Mail shell declares `color-scheme: light only` (+ `bgcolor` on the header/body cells) so Apple Mail / Outlook dark
  mode no longer invert it into a mint header on a dark body.
- **Response cache made durable and self-warming** (`respCache.js`) — the "Loading…" after a deploy or a sync tick
  is gone for good: (1) the cache is snapshotted to `cache/respcache.json` every minute and on shutdown and restored
  at boot, every entry served instantly as *stale* while the real recompute runs behind it; (2) `invalidate()` after a
  sync now marks entries stale instead of clearing them — nobody pays a full recompute after a tick; (3) **keep-warm**:
  every TTL the top `RESP_CACHE_WARM_TOP` (40) most-requested URLs that went stale are re-fetched over loopback so hot
  pages are fresh before anyone asks. `RESP_CACHE_FILE`, `RESP_CACHE_FILE_MAX_MB` (64) tune it.
- **Mobile dashboard renders progressively**: every section shows its title and a loader at once and fills in when its
  own data arrives, three sections in flight at a time — before, all sections ran one after another off-screen and
  the page sat on "Loading dashboards…" until the slowest finished.
- **Healthcheck knows a local replica from a prod source**: when `SOURCE_DATABASE_URL` / `NEXUS_DATABASE_URL` point at
  the console's own Postgres server (the copy prod-sync maintains) the probe is labelled *Local replica*, thresholds
  follow `SOURCE_POOL_MAX` (+4 warn / +10 crit) and it can never flag *prod impact* — the CRIT "11 connections on the
  selfcare replica" was our own pool on our own server.
### Fixed
- Order-status-flow → **Timeline →** opened an empty "Transaction timeline" (0 events): the button passes the
  onboarding order uuid and the reference resolver only knew payment uuids / trace ids, so it fell through to
  the case analyzer. The resolver now looks up `onboarding_orders.id` first and anchors the full customer
  timeline on the order's MSISDN and time.
- Home for a single-business account (Mobile-only / Fixed-only) no longer shows the other business's empty column
  and empty "Needs attention" box: one full-width column, only that business's quick links, heading adapted.
- Detail drawers (tickets, user panel) opened *under* the sticky header on desktop, hiding the title bar and its ×
  (`.drawer-ov` z-index 210 vs header 1200; the phone rule already had 1300). Base rule raised to 1250.

## [2.0.0-alpha.16] — 2026-09-07 — Fixed › Errors: export XLSX / PDF
### Added
- **Fixed › Errors: export XLSX / PDF** (team request) — two buttons next to Clear export the board exactly as filtered:
  a Summary (period, every active filter, totals by category / team / priority / provider) and the full error list —
  time (KSA), priority, team, category, code, message, endpoint, method, HTTP status, **response time (ms)** (joined
  from `api_calls` on the failing step), provider, channel, dealer / QR, region, order #, workflow id, status, acked by,
  **request** and **response** bodies (masked as on the board). XLSX up to 5 000 rows (two sheets); PDF up to 400 rows
  with bodies trimmed to one line. `GET /api/fixed/errors/export?format=xlsx|pdf&…` (cap `export`, audited
  `fixed.errors.export`).
### Fixed
- **`/api/version` reported `2.0.0-alpha.8`** whatever was deployed — it read `server/package.json`, which is not bumped
  per milestone. `deploy152/deploy.sh` now writes `server/build.json` (repo `VERSION`, git commit, tag, build time) at
  stage time and `reliability.version()` reports it (`version`, `commit`, `tag`, `builtAt`); package.json aligned.
- Monitoring › Gateway header read "last undefinedh" when a collector is not configured (window label now falls back to
  the selected range). The empty Gateway / API-health / UIL panels on the unified console are **configuration, not code**:
  the readers (`ZIPKIN_HOSTS`, `API_LOG_*`, `DMSLOG_*`, `UILS_SAMPLE`) were stripped from the copied `.env` during the
  shadow start — see the runbook in this entry's deploy notes / `docs/ALERT-MAIL.md` §collectors.

## [2.0.0-alpha.15] — 2026-09-07 — alert mails for both businesses: PDF for Mobile, map / error-board links for Fixed
### Added
- **Fixed rows in the alert digest carry the retired Operations Console's "Inspect in console →" link, on the unified
  routes** (`server/src/fixedLinks.js`): Nafath / Semati spikes → the SDA map pre-filtered to the failing 5G attempts
  (`#fixed?tab=map&plans=fiveGWhiteLabel,fiveGFWA&nafath=not_completed&range=24h`), error spike / timeout waves → the
  error control board, SDA activity rules → the map, ticket rules → the Fixed dashboard. Every Fixed row's "Open ›"
  goes to **Fixed › Alerts**, never to the Mobile `#alerts` page a Fixed-only reader cannot see.
- **`fixed-map.js` reads deep-link filters from the hash** (`plans`, `nafath`, `semati`, `outcomes`, `regions`, `roles`,
  `dealerId`, `range`) and applies them once per distinct query — a mail link lands on the exact rows behind the alert.
- **The per-alert PDF now covers Fixed rules too**: evidence comes from the dealer-ops read model (`sda_ops`, read-only)
  instead of the Mobile API capture — failing 5G attempts (plan, dealer, region, Nafath outcome, last error), open
  error events, or the incident tickets of the rule's theme — plus the Fixed console links in the header.
- **`node src/cli.js testmail <rule-key> <email>`** — simulate one rule (Mobile or Fixed) firing and mail the digest +
  PDF to that address only. The way to verify the mail chain on 152 without a browser session.
- Segment chip (📱 MOBILE / 🏠 FIXED) on every digest row and intro line.
- **Fixed › Errors: provider filter** (team request) — a chip row under Priority, before the KPI tiles: DAWIYAT / TLS /
  STC … discovered from the failing call's request body (`"provider"`), plus a *no provider* bucket for events whose
  request carries none (Nafath, payment, BSS). Clicking a chip filters the tiles, the counts and the rows; chip counts
  are computed without the provider filter so they never drop while one is selected. `GET /api/fixed/errors/summary`
  returns `byProvider`; `summary` and `live` accept `provider=<NAME>` or `provider=-`.
- **Fixed › Errors: Last 32h / 48h / 72h windows** between Last 24h and Today (team request).
### Changed
- **The built-in sync scheduler (Settings → Sync, "Auto · Live") now mails the digest when a rule opens**, exactly
  like `/api/sync` does when the prod-sync scheduler drives the loop — and only when prod-sync is *not* armed, so a
  console running both never mails twice. Before, a console without `PROD_DATABASE_URL` evaluated its rules and
  mailed nobody.
- `alertRunner.evaluate()` rows carry `segment`.
### Verified
- Digest + four PDFs rendered headless with stubbed data (3 Fixed rules, 1 Mobile): links, chips, evidence tables,
  PDF header links all correct; Mobile path byte-identical to the digital console apart from branding.

## [2.0.0-alpha.14] — 2026-09-07 — Users page: edit panel, block / unblock in sight · one mail template
### Changed
- **Every mail the console sends now uses the Undertaking Consent System template** (`notify.shell`, ported from the
  deployed undertaking bundle, table-based for Outlook): `#0b3d2b` header with the white Salam logo attached as a
  CID image (`mailBrand.js` embeds the PNG so it always ships and renders without "load images"), a system badge
  (`MAIL_SYSTEM_BADGE`, default OPERATIONS CONSOLE) plus an optional status pill, white body, quiet footer
  (`MAIL_FOOTER`). The OTP mail (`otp.js`) goes through it too — subject "Salam Operations Console — sign-in code",
  same wording as the undertaking OTP — instead of its own unstyled HTML; sync-health, alert digests and ticket mails
  pick it up automatically. `notify.sendText()` wraps plain text (URLs linked) for short transactional mails.
- **Sender name enforced in code** — `/apps/unified/.env` was copied from the digital console, so its `SMTP_FROM` said
  "Salam Digital Console". `notify.fromAddress()` keeps the address (the relay whitelists it) and always labels it
  "Salam Operations Console" (`MAIL_FROM_NAME` overrides). Footer is "— Salam Operations Console · automated message".
- **OTP code is a big copyable block** — 38 px letter-spaced monospace digits on their own line (letter-spacing is
  CSS, so one selection copies exactly six digits). Remaining "Digital Console" product strings (Yusr system prompt,
  Monitoring self-check text, data-file headers) renamed to Operations Console.
- **Settings → Users** — the row is now USER (email + name · mobile · team) · BUSINESS · ROLES · TAGS · STATUS (with
  last-seen) · MAIL · **ACTIONS**. The old table had 12 columns and the Block button sat off-screen to the right;
  name and mobile were unstyled inline inputs nobody recognised as editable.
- **✎ Edit** opens a side panel (full screen on phones) with every field of the account — name, mobile, team,
  business, roles, tags, mail flags, quick-tour reset — plus a provenance line for imported accounts (which console it
  came from, legacy Fixed roles) and a marked danger zone for Block / Unblock. Saves with one PATCH.
- **Block / Unblock** on the row too: Block arms on the first click ("Confirm block", 4 s) — no browser dialog. Blocked
  rows strike the e-mail through. USER and ACTIONS stay sticky while the middle scrolls; on phones the table keeps
  only user · status · actions (everything else lives in the panel).

## [2.0.0-alpha.13] — 2026-09-06 — data convergence: people & history from both prod consoles
### Added
- **`server/scripts/converge-import.cjs`** — one-way merge of the two prod consoles into `unified_console`:
  users (union by e-mail), audit trail, alert history, metric snapshots, tickets (+ comments / files),
  dashboards / SLOs / error codes, and archives of the Fixed console's incidents, playbooks and rule definitions.
  Dry-run by default; `--apply` writes. Sections are selectable (`--only=`), the history window is
  `--months=` (default 12). Every `--apply` run is recorded in `converge_runs`.
- **`server/db/converge.sql`** — additive schema: provenance (`source`, `legacy_id`, `legacy_ref`, `imported_at`)
  with unique indexes that make the import idempotent, plus the `legacy_incident_log` / `legacy_ops_docs` /
  `legacy_alert_rules` archives and `converge_runs`.
- `docs/DATA-CONVERGENCE.md` — what moves, what stays read-only in `sda_ops`, the merge rules, the runbook and
  the rollback.
### Merge rules worth knowing
- **Business scope is derived from where the account exists**: digital console only → `mobile`, sda_ops only →
  `fixed`, both → `both`. One import populates the alpha.11 business scope for everyone.
- Legacy `SUPER_ADMIN` lands as `admin` unless the e-mail is passed in `--super-admins` — a legacy database must
  not be able to mint a super admin here. When a person exists in both consoles the digital role wins.
- The script reads the merged role map and **warns when fixed-only users would land on a role that holds no Fixed
  view** (they would sign in to an empty console).
- Nothing already in the unified console is overwritten: existing users keep role / enabled / business / mail,
  existing dashboards, SLOs, error codes and settings keys win over the legacy copy.
- Credentials (password hashes, OTP codes, session jti) are never imported; settings rows whose key or value
  matches `secret|token|password|webhook|smtp|api_key|credential|bearer` are skipped; imported users land with
  mail off unless `--mail-allow` lists them; legacy ticket refs are prefixed `D-` so they cannot collide.
- Importing `metric_snapshots` is what closes the anomaly-baseline gap between this console and the digital one.
### Changed
- `deploy152/deploy.sh` now ships `server/scripts/*.cjs` (and syntax-checks them) — one-off jobs reach 152 with
  the normal deploy instead of being scp'd by hand.
### Fixed (same day)
- The first dry run on 152 died at the 2 GB heap limit: `mvno_console.metric_snapshots` holds 22.7 M rows and the
  importer loaded a year of them into one array. `audit`, `alerts` and `snapshots` are now **streamed** (keyset
  pagination on `id`, `--page` rows in memory at a time; a dry run only counts) — verified under a 64 MB heap.
  `snapshots` is now **opt-in** with its own `--snapshot-days` window (default 14): it is chart history only —
  the seasonal baselines come from `rollup_hourly`, which this console rebuilds from the replica itself, so the
  earlier note that snapshots "close the anomaly-baseline gap" was wrong and is withdrawn.
### Verified
- Rehearsed end to end on a throwaway Postgres 16 with all three schemas and seeded edge cases (shared account,
  blocked user, legacy `SUPER_ADMIN`, ticket-ref collision, `FIRED`/`OK`/`SKIPPED` events, rows outside the
  window): correct business split, provenance, role mapping and secret filtering; idempotent across three
  consecutive `--apply` runs; a hand-edited user survives a re-run untouched.

## [2.0.0-alpha.12] — 2026-09-06 — dark mode complete · phone / tablet app shell
### Changed
- **Dark mode, every page.** New tokens in `index.html` (`--violet`, `--indigo*`, `--good`, `--warn-fg`, `--bad-fg`,
  `--*-line`, `--solid`, `--tip-bg`, `--switch-off`, `--overlay`, `--scrim`, `--panel/--panel2/--fg` aliases) and every
  hard-coded light pair (`#fee2e2/#b91c1c`, `#dcfce7/#166534`, `#fef3c7/#92400e`, indigo doc blocks, `#64748b`
  muted text, `#0f172a` code panes, `#fff` backgrounds …) in `index.html` and in 25 modules now reads a token, so
  chips, badges, tint boxes, doc blocks, tooltips, switches, the dashboard order-flow tree (SVG fills), inverted
  "All" chips (`var(--solid)` — never `var(--ink)` as a background) and native controls render correctly in both
  themes. Zero-specificity `:where()` base for `input / select / textarea / button` (no browser-default grey
  anywhere, custom select arrow, dark date pickers, themed scrollbars, `::selection`, `color-scheme`).
- **App shell for phones and tablets** (`adaptive.js` + the "ADAPTIVE UI LAYER" in `index.html`):
  ≤1140 px the nav becomes a slide-in drawer (header + close, scrim, Esc, grouped Mobile / Fixed sections in their
  accent colours, Theme / Arabic / Guide / Settings shortcuts); ≤700 px a bottom tab bar (Home · Mobile · Fixed · 360
  · Menu) mirrors the nav — a tab is hidden exactly when the role / business scope hides the nav entry — and the
  header collapses to logo + icons. Modals and the ticket form open as bottom sheets (above header and tabs), the
  side drawer and Yusr go full screen, the guided-tour card fits the width, safe-area insets are honoured
  (`viewport-fit=cover`, `theme-color`, home-screen capable).
- **Layouts that measure instead of guess**: inline grids are stacked only when a column would drop under 150 px
  (`fitGrids` → `.g-stack` / `.g-two`), overflowing tables get a horizontal-scroll wrapper (`wrapTables` →
  `.tscroll`) after every render, grid children get `min-width:0` (no blow-outs), the page itself never scrolls
  sideways (`main{overflow-x:clip}`). Hub sticky bars (Fixed, DMS, Monitoring, Customer 360) sit under the header
  (`top:var(--hdr)`) instead of behind it. SDA map / QR pages: tablet = filters on top, map + detail side by side;
  phone = one column with a 56 vh map. Touch targets ≥ 36 px on coarse pointers, 16 px inputs on phones (no iOS zoom).
- Drawer CSS is scoped to `header>nav` (the Monitoring sub-tabs are a `<nav>` too).
- **Drawer menu reworked** — navigation carries a single accent again: the Mobile group label is no longer violet
  (violet stays a *business* marker: ticket modal, business chips, Customer 360 services). Groups are separated by a
  hairline and a green-tinted group icon instead of a colour per business; Home and Customer 360 sit at the top as
  shortcuts (360 keeps its red); every entry is one 28 px-icon row with a green tint + white icon when active.
  Each group's **EXPLORE section folds away** behind its own label (item count + chevron, auto-opened when the current
  page is inside it), so Mobile *and* Fixed are both reachable without scrolling — previously Fixed sat below twelve
  Mobile rows. The bottom tab bar's active tab is green (top bar + heavier stroke), red only for Customer 360. The
  collapse affordance is drawer-only; the desktop dropdown is unchanged. Toggle listens in the capture phase because
  `navdrop.js` stops click propagation inside the panel.

## [2.0.0-alpha.11] — 2026-09-06 — business scope per user
### Added
- **Business scope** — every user is Mobile (MVNO team), Fixed or both (`console_users.business`, default both).
  Roles say *what*, business says *on which side*; the two are intersected once at session time
  (`roles.scopeViews`) so the API gates, navigation, router, Home, Customer 360, Yusr, the ticket modal and the
  guided tour all follow. Fixed-only sessions additionally get an API allow-list (Mobile endpoints answer 403).
  Deep links to the other side show "Not part of your business". Set per user in Settings → Users (BUSINESS
  control, also on the new-user card). Design: `docs/BUSINESS-SCOPE.md`.
### Changed
- Mobile accent is now **violet** (`#7c3aed`) next to Fixed green — ticket modal, ticket board pill, Business
  control, Customer 360 services strip.

## [2.0.0-alpha.10] — 2026-09-06 — map pages redesigned
### Changed
- **Fixed hub bar carries no filters any more** — the Channel / Range chips under the page title are gone. Channel is always
  "All" (Errors and Reports own their channel controls); the range is chosen inside the page that uses it — Overview
  (top right), SDA map and QR codes (sidebar "Range"), Reports (toolbar) — via `fx.rangeChips()` / `fx.bindRange()`.
- **Raise a ticket, business-first**: step 1 picks 📱 Mobile or 🏠 Fixed as two themed tabs (blue / green — header,
  accent, hints and the submit button follow the choice, pre-selected from the page you are on); step 2 is the form
  (Issue / Suggestion pills, title, description, screenshots). Themed confirmation, Esc closes. No native controls.
- **Customer 360 — Services strip** in the sticky header: every service the customer has, both businesses, as cards —
  📱 one per Salam line (click = the line BSS panels read) · 🏠 one per fixed subscription from the BSS inventory
  (account, plan, speed, state, amount owed; click = Fixed services tab) — with a total and a mobile / fixed count.
- Errors board: fixed `CSS.escape is not a function` (a local `CSS` constant shadowed the browser object), row toggle
  reads the DOM, auto-refresh keeps the open row, stale category filter dropped and shown as a removable chip.
- **SDA map · QR codes — one design system** (`fixed-maps-ui.js`, shared stylesheet injected once): filter chips with
  hover lift / press / check mark and a page accent (green dealers, violet QR); KPI tiles with accent bar and hover
  elevation; sidebar groups with accent headers; glass legend and map note; restyled ⌂ KSA control; skeleton loaders
  instead of "loading…"; export / reset / refresh / back as real buttons.
- **Recent orders** in the dealer and QR panels are a clickable list (outcome pill with live pulse for in-progress,
  plan / consent / error tags, step reached, order number, chevron on hover) instead of a raw monospace table.
- **Order trace modal** rebuilt: sticky header with outcome colour stripe, outcome pill, circular close button and an
  amber "Unmask · audited" button; fact cards; journey steps as a timeline with connector line and a pulsing current
  step; API calls as an accordion (status badge, latency, request / response side by side); Esc closes; open animation.
### Fixed
- Fixed › Overview with Salam Home app selected: the Live banner named `sda_ops.public` and Error categories were empty
  — both now follow the channel pool (beta schema).
- **Fixed › Errors search returned nothing for an ODB / ID that the prod board found** — the unified board inherited the
  hub channel chip (SDA dealers), which silently excluded QR / e-purchase errors; it now starts on **All channels** like
  `/operations-console/errors` and follows the hub chip only when the user changes it. Identifier search also matches
  the event row (order / referral / dealer / attempt id) in addition to the attempt, and applies live as you type.
- **Fixed › Errors UI aligned with the prod board**: title + subtitle, two cards (window chips · channel select · open-only
  / counts / clear — and the stacked identifier search: any-ID, service no + All / FTTX / 5G, ODB, four IDs, two IDs),
  team and priority chips, category tiles, table with priority badge / category pill / green QR link / status colour,
  expanded row with What happened, Request / Response, Similar cases and Open full trace.

## [2.0.0-alpha.8] — 2026-09-06 — tickets by business · Fixed pages in user management · guided tour rebuilt
### Fixed
- **Salam Home app channel returned "No data" on Fixed › Reports / Overview / SDA map / Errors** — those pages always read
  `sda_ops.public` (prod), where Salam Home app rows do not exist (stage 1 keeps them in the beta schema). Every Fixed
  query is now routed by channel (`f360.poolFor`): Salam Home app → beta schema, dealers / e-purchase → prod. Attempt
  trace and error detail fall back to the beta schema when an id is not found in prod. Reports shows a hint that the
  Role / Region dealer chips do not apply to the app channel.
- **Two menus highlighted at once** — the Fixed group button kept its "on" state (and current-page chip) after
  navigating to Home or a Mobile page; the nav now clears the Fixed pages' active state whenever the hash leaves
  `#fixed`, and clears Mobile/Home when it enters it. Exactly one group is current.
- **Deploy:** unified target listens on **:4701** on 152 (4700 is `salam-undertaking`); `deploy.sh` creates the target
  tree on first deploy; `docs/DEPLOY-UNIFIED-RUNBOOK.md` added (isolation guarantees, milestone cadence).
### Added
- **Tickets tagged 📱 Mobile / 🏠 Fixed** — `console_tickets.segment` (default `mobile`, so every ticket raised before the
  Fixed side existed is Mobile). Raise-a-ticket asks which business (pre-selected from the page you are on); the
  admin board filters by business and shows open counts; the drawer lets admins re-tag; the confirmation e-mail names it.
- **User management covers Fixed** — the matrix now gates every Fixed page (Overview · E-purchase · Salam Home ·
  SDA map & QR · Reports & KPI digest · Errors · Alerts · Playbook & Diagrams) under a 🏠 FIXED PAGES header next
  to 📱 MOBILE PAGES; nav items and APIs answer to those views (deep links fall back to the first page the role holds).
  New roles **Fixed Ops** and **Salam Home (B2C)**; Sales Ops gains the Fixed dealer maps & reports; team tag FIXED.
  Old overrides saved with `maps` / `b2c` translate automatically.
- **Guided tour rebuilt** for the new navigation: 17 role-aware steps, one icon + one line per idea, opens each
  dropdown to spotlight the real item, covers Home, Mobile, Fixed (Overview, channel dashboards, maps, errors),
  Customer 360, Yusr, Settings, Help / tickets. Keyboard: ← → (or Enter / Space) to move, Home / End, Esc to close.
  Fixes from the first run: the card no longer lands off-screen (menu items are revealed after the click that
  brought you there has finished bubbling — navdrop closes menus on any document click), Fixed steps really open
  their page, the card flips above the target when it would run off the bottom, and the overlay sits above the
  header and open dropdowns so a menu never covers the card.

## [2.0.0-alpha.7] — 2026-09-05 — Fixed › E-purchase and Fixed › Salam Home channel dashboards
### Added
- Two new Fixed pages between Overview and SDA map: **E-purchase** (web / QR flow, consumer-direct included) and
  **Salam Home** (Pulse app: buy FTTH + freeze / unfreeze / relocation / change plan / renew). One renderer
  (`fixed-channel.js`), one API (`server/src/fixedChannel.js`, `/api/fixed/channel/:channel/all`, fail-soft per section).
- MVNO-Dashboard style: **customisable sections** (⚙ Customize — pick + order, saved per user), **every section split
  FTTX (FTTH | FTTB, always apart) | 5G home** with a product toggle, deltas vs the previous window, and auto-written **business / technical
  findings** (P1–P3, click → section).
- Sections: KPIs · Findings · Journeys · Flows (funnel + stops per day) · Plans · Campaigns · Payments (payments_v2:
  success / failure rate, processing time, status, method, source, per plan, peak hours, daily / monthly / yearly
  revenue, declines, paid-with-no-order) · Errors (business rule vs fault, per day, unsuccessful OTP) · Integrations
  (systems, endpoint families, p50 / p95, failures per day) · Regions. Every panel of the Grafana boards
  (Monitoring Live all / FTTH / 5G, Payments) has a home here — mapping in `docs/FIXED-CHANNEL-PAGES.md`.

## [2.0.0-alpha.6] — 2026-09-05 — Yusr: Fixed follow-ups, both sides of a customer, honest status
### Fixed
- **Yusr follow-ups** — "where is the FTTH service for this customer?" after a lookup went to the runbooks. The key
  from the previous turn (National ID / MSISDN / FTTH / order / code) is now reused, so a Fixed question about "this
  customer" answers from the Fixed read model; a Fixed question with no customer at all asks for the key instead of
  quoting Tap docs.
- **One identity, both businesses** — a National ID or mobile now answers with the Mobile lines AND the Fixed
  services/journeys (or says which side is empty) even in data-only mode; actions open Customer 360 → Fixed services
  (`#sub360?key=…&tab=fixed`). "Subscriber 360" wording → **Customer 360**.
- **Status line** — the header claimed "Online" before any call; it now probes the model host on open
  (`GET /api/assist/status`) and shows Data-only / Online truthfully, with the reason on hover.
- **Local model host** — the console DB (a prod clone) points Yusr at `host.docker.internal:11434`; `OLLAMA_URL_OVERRIDE`
  (written by `env-from-152.sh`, tunnel port 21434) redirects it to 152's Ollama. `OLLAMA_MODEL_OVERRIDE` likewise.
- **"None of them are activated" (case 2392697450)** — Yusr's customer pack carried only onboarding ATTEMPTS
  (`lines`, one per order incl. abandoned checkouts) and the model read their `payment` state as "not activated",
  while the customer's real line lives in `users` / BSS. The pack now carries `service_lines` (the same resolver
  Customer 360 uses: app account → activation → MNP → partner DMS → live BSS, plus the BSS profile of the primary
  line when the gateway is configured), the attempts are labelled as attempts, the system prompt forbids inferring
  activation from attempts, and the data-only answer prints "Active line(s)" first. `tools/local/probe-identity.cjs`
  dumps every source for one NID (replica, nexus workflows + BSS endpoints + latest inventory responses, sda_ops).
- **Fixed inventory — "what the customer HAS"** (`server/src/fixedInventory.js`). The Fixed side only knew journeys
  (order_attempts), so an FTTH activated before / outside the app was invisible (case 2392697450: FTTH09071297,
  Salam Fiber Postpaid 300, active since 2025-08-03). The Salam Home app resolves any National ID through four ZSmart
  reads — `salamchecknid` → `salamqueryacct` → `qrysubslist` → `qryacctowefee` — and nexus logs every call. Two tiers,
  one shape: **recorded** (latest logged responses in the customer's own workflows — works wherever NEXUS is
  configured, carries `as_of`) and **live** (same read-only whitelist against `FIXED_BSS_BASE`, snapshot-cached
  10 min in `fixed_inventory_snapshots`, off until the base is reachable from 152). `/api/fixed/customer` returns
  `inventory` + `inventory_summary`; Customer 360 → Fixed shows "what the customer has" above the journeys; Yusr's
  `fixed_customer.inventory` answers has/active/plan/owed questions and the prompt forbids inferring "no service"
  from journeys. Tunnel gains `18080 → 172.20.53.30:8080`; `FIXED_BSS_BASE` documented in `env-from-152.sh`.
- **Yusr identity answers are now fact-first.** The model still paraphrased packs into contradictions ("three lines,
  none activated") and the Fixed inventory fell off the 3,500-char context cap. `identityFacts()` computes the
  verified header deterministically (📱 active lines · attempts count · 🏠 BSS services with plan/state/since/owed ·
  journeys count), puts it FIRST in the context, tells the model not to restate or contradict it, and PREPENDS it
  to every customer / fixed_customer reply; the customer pack is trimmed when both sides are present.
- **Home — both businesses top and bottom.** Insights row: up to 3 Mobile + 3 Fixed cards, Fixed always gets today's
  open error categories (P1 when a category > 1,000 open). Needs-attention Mobile column now lists open incidents,
  the seasonal anomalies (the P1s from the insights row) and the Error Control Board categories (24 h, business /
  technical split) instead of just "no open incidents".
- **Home overlapping Yusr** — the two column headers were `<header>` elements, so the global sticky top-bar rule
  (z-index 1200) floated them over the Yusr panel. Plain `<div>` now; Yusr sits above the header (1250).

## [2.0.0-alpha.5] — 2026-09-05 — executive Home · nav tooltips · Yusr covers Fixed
### Added
- **Home** is now an executive landing: global status indicators (Mobile journeys, Payments, Activation, Fixed journeys,
  Identity/Nafath, Fixed data, Incidents — green/amber/red with tooltips), auto-written **insights** (seasonal anomalies,
  week-on-week activations and completed Fixed orders, top Fixed error, Nafath failure), a **growth** row (7 d vs previous
  7 d with 30-day sparklines for Mobile activations/orders and Fixed completed/attempts), the two business columns, and a
  **needs-attention** block (open incidents · open Fixed error categories). Every element links to its page.
- **Yusr** understands Fixed: an FTTH account / order number / customer code / ODB / ICCID → Fixed customer view
  (services, attempts, errors, payments); "fixed issues today / this week" → Fixed status (KPIs, per-journey conversion,
  Nafath/Manafith, error categories, recent errors, freshness); a Mobile customer lookup also returns their Fixed services
  through the nexus bridge. Offline fallbacks and suggestions included.
### Changed
- Menu descriptions moved out of the buttons into animated tooltips (hover/focus); one Customer 360 entry (the red 360
  pill is gone); tighter top bar.

## [2.0.0-alpha.4] — 2026-09-05 — salam.sa-style navigation · Customer 360 across both businesses
### Changed
- Top bar is now **Home · Mobile ▾ · Fixed ▾ · Customer 360**. Home (`landing.js`, `#home`) is a new shared landing page:
  greeting, quick links, and two equal columns — Mobile (orders, checkouts, payments, activations, Nafath, deliveries,
  errors + NOC status and open alerts) and Fixed (attempts, completed, BSS orders, dealers, Nafath/Manafith, open errors +
  data freshness) — every tile links to its page. The MVNO dashboard moved into Mobile ▾ as its first item (`#dashboard`).
  The Fixed group's sub-menu has OPERATE (Overview, SDA map, QR codes, Reports, Errors, Alerts) and EXPLORE (Playbook,
  Diagrams, KPI digest). Header stacks above map panes (z-index) so menus never hide behind Leaflet/Google.
- Dropdowns are click-to-open only (hover closed the panel while crossing the gap — the "can't navigate" bug); the Mobile /
  Home button shows the current page ("Home · SDA map"); Fixed pages lost their in-page tab row (the menu is the menu) and
  carry a breadcrumb title instead; the shared Dashboard gains a **Home · Fixed** strip (attempts, completed, BSS orders,
  active dealers, Nafath/Manafith, open errors, data freshness) so both businesses are on the landing page.
- **Navigation** now mirrors salam.sa: `Dashboard` · **Mobile ▾** (MVNO: Monitoring, DMS dealers, Troubleshoot, Alerts +
  Explore: Topology, API Gateway, OTO/Tap/Salam API docs, Journeys, Integrations) · **Home ▾** (Fixed: Overview, SDA map,
  QR codes, Dashboards, Errors, Alerts, Playbook, Diagrams, Report) · **Customer 360**. Dropdowns are presentation only
  (`navdrop.js`); the buttons stay `.navtab`, so role scoping, routing and the tour are unchanged. Home items deep-link
  `#fixed?tab=<page>`. The Explore block left the "?" menu (Guide, On-call, Feedback stay there).
- **Subscriber 360 → Customer 360** (`sub360.js`): one search box for both businesses. Mobile keys (MSISDN / NID) as
  before; Fixed keys (FTTH account, customer code / ID, BSS order no, 5G number, ICCID, ODB) resolve through the new
  `GET /api/fixed/customer` (`server/src/fixedCustomer.js`: prod + beta read models, error events, payments_v2 when
  granted). Both found → extra "Fixed services" tab with count; fixed-only → fixed layout; 5G numbers cross-search the
  mobile side (unmasked, audited). Identifiers masked to last digits by default.
- Maps: OpenStreetMap/Leaflet engine (`fixed-leaflet.js`) used automatically when Google is unavailable.

## [2.0.0-alpha.3] — 2026-09-05 — every Operations Console page under the Fixed tab
### Added
- Fixed tab is now a hub with sub-tabs mirroring salam.sa/operations-console: **Overview · SDA map · QR codes · Dashboards ·
  Errors · Alerts · Playbook · Diagrams · Report** (`fixed.js` hub + `fixed-<page>.js` per page; contract in
  `docs/FIXED-PAGES-CONTRACT.md`). Deep links `#fixed?tab=<page>`.
- Backend modules `server/src/fixed{Map,Errors,Dash,Alerts,Docs,Report,Metrics}.js` — SQL ported 1:1 from the dealer-ops tRPC
  routers; routes under `/api/fixed/<page>/*`, all gated by the `fixed` view; PII last-digits by default, unmask via
  `unmaskPII` cap + `pii.unmask` audit (nexus live fetch).
- Alert engine: 12 `fixed_*` metrics + 15 `fixed_*` rules (14 prod built-ins) with `segment` column on alert_rules/alerts;
  duplicate-key guard in metrics.js; Alerts page shows unified rules, history and the prod engine side by side (transition).
- Playbook (SLA/OLA/action plans) read from `ops_docs`, edits stored in the console DB (`fixed_playbook_overrides`);
  Diagrams (4 static pages copied to `fixed-diagrams/`); branded KPI digest (`/api/fixed/report/html`).
- Error acks stored in the console DB (`fixed_error_acks`) — `sda_ops` stays read-only.
### Ops (5 Sep, beta instance on 152)
- Found and fixed the 22 Aug `opsb-ingest-watch` outage: a 6.5 KB `odb` value exceeded the btree limit of `beta.order_attempts_odb_idx`
  → Prisma crash-loop → 34 orphaned query-engine processes exhausted the `sda_ops_beta` 20-connection cap. Orphans killed,
  index recreated as partial (`WHERE length(odb) < 1000`), watcher restarted with `DB_WATCH_API_LOGS=0`; backfilled 28 Jul → now.
- `tools/local/sql.cjs` gains `OPS_BETA` and `--write` (one-off DDL through the tunnel); maps pages fall back to SVG on
  `RefererNotAllowedMapError`; all Fixed pools run `default_transaction_read_only=on`.

### Changed
- Stage-1 source is now the **prod** read model `sda_ops.public` via the read-only role (`OPS_DATABASE_URL`); the beta schema is
  a secondary pool (`OPS_BETA_DATABASE_URL`) used only for Salam Home app (B2C) rows.

## [2.0.0-alpha.2] — 2026-09-05 — Phase 1 (first cut): Fixed tab + product name
### Added
- **Fixed tab** (`#fixed`, view `fixed`, `fixed.js`): freshness strip (ingest cursor / watcher lag), KPIs (attempts,
  completed, conversion, BSS orders, active dealers, avg time), outcome mix + per-day bars, by workflow, by channel,
  Nafath outcomes, Manafith denials, regions, top dealers, error categories, Salam Home app (B2C) journeys,
  recent attempts with find (ODB / order / service / ICCID / mobile). Channel + range filters persisted.
- `server/src/fixed360.js` + routes `/api/fixed/{summary,b2c,attempts,dealers,errors}` — SQL ported 1:1 from
  salam-dealer-ops (dashboards/activity/errors routers) over `sda_ops.beta`; consumer-direct e-purchase excluded by
  default like the beta; identifiers returned as last digits only. All routes gated by `requireView('fixed')`;
  searches audited as `fixed.search`.
- `ROLLUP_BACKFILL_DAYS`, `PG_APP_NAME`, `APIGW_PROBE_AUTO=0` for local runs; tunnel forwards UPG :5434.
### Changed
- Product name is **Salam Operations Console** (header chrome, login, title, e-mails, i18n en/ar).
- `roPool()` honours Prisma-style `?schema=` (search_path) and strips Prisma-only params — required for `sda_ops.beta`.

## [2.0.0-alpha.1] — 2026-09-05 — Unified Console, Phase 0
The Digital Console codebase becomes the **Salam Unified Console** (Fixed + MVNO). Plan: `docs/UNIFIED-CONSOLE-CONVERGENCE-PLAN.md`.
The frozen digital-console line is tag `v1.1.0-digital-console-freeze` / branch `release/digital-console`.

### Added
- `base.js`: single source of truth for the URL prefix (`window.CONSOLE_BASE`, `window.API_BASE`); works under
  `/unified-console`, `/digital-console` or root (local). Replaced the hard-coded `/digital-console` in 28 files.
- `server/src/db.js`: optional read-only pools `ops` (sda_ops_beta), `nexus`, `payments` (payments_v2) via
  `OPS_/NEXUS_/PAYMENTS_DATABASE_URL`; distinct `application_name`s for the DBA.
- `server/src/fixed.js` + `GET /api/fixed/ping`: Fixed-side connectivity/status probe; `/api/health` and
  `/api/version` now report the Fixed pools, `FIXED_ENABLED`, and the public URL.
- `roles.js`: views `fixed`, `maps`, `b2c` exist only when `FIXED_ENABLED=1` (super_admin + admin get them).
- Local dev kit: `docker-compose.unified.yml` (local `unified_console` DB on :5700), `tools/local/tunnel-152.sh`
  (152 as passerelle to 172.31.15.121 and friends), `tools/local/env-from-152.sh` (builds `.env.local` from the
  two prod env files, hosts rewritten to the tunnel, prod-only side effects dropped), `tools/local/dev.sh`.
- `deploy152/deploy.sh` `DEPLOY_TARGET=unified|digital`; `ecosystem.prod.config.js` reads `PM2_NAME`/`PORT` from `.env`.
- `CLAUDE.md` working notes for the build sessions.

### Changed
- Product name in UI/e-mails: "Salam Unified Console"; e-mail links use `CONSOLE_PUBLIC_URL`
  (default `https://salam.sa/unified-console/`).
- `VERSION` 2.0.0-alpha.1; `server/package.json` renamed `unified-console-server`.

## [1.1.0] — 2026-09-04
Freeze of the Digital Console exactly as deployed on 152 (180 files changed since 1.0.0; see git history).

## [1.0.0] — 2026-07-22
Initial import of the Salam MVNO Digital Console (NOC / ops dashboard for the MVNO).

### Dashboard & journeys
- Real-time NOC status banner, journey-health strip, and live order-status flow tree (New SIM / MNP → eligibility → payment → activation/delivery), reconciled to the Orders KPI.
- Configurable home sections (per-user pick + reorder), date-range filter, role presets.

### Alerts engine
- Metric registry + rule catalog (P1–P3) evaluated over the prod replica; seasonal-baseline anomaly detection.
- Root-cause correlation / suppression: provider outages page once (root) with symptoms grouped, not a storm.
- Guided Response on alerts (runbook + notify on-call + related tickets), runbooks on all rules.
- ChatOps notifications (Teams/Slack/WhatsApp/SMS) + on-call escalation ladder.

### Providers & troubleshooting
- Semati/CITC provider-outage detection (715 / transport / flapping / zero-success / CITC composite) + synthetic canary.
- Troubleshoot error control board: per-category tiles, code·message breakdowns (Semati / Nafath / Payment), per-category shareable URLs, transaction timeline.
- Payments RCA reference + UPG correlation; Samsung Pay proactive detection; decline code·message drill-down.

### Growth analytics
- Resellers (flow_type funnel + tygo/soob channel breakdown), Campaigns (UTM source/medium/campaign with humanized labels), and an acquisition × distribution correlation matrix. Home summary cards + full Growth dashboard.

### Data trust & ops
- Loud replica-staleness banner, Settings health self-check, in-container prod-sync scheduler.
- ServiceNow read-only ticket correlation; Yusr (يُسر) local-LLM assistant.

[1.0.0]: https://github.com/yyahmed82/salam-mvno-console/releases/tag/v1.0.0
