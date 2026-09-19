# Changelog

All notable changes to the Salam MVNO Digital Console are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/); this project uses [SemVer](https://semver.org/).

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
