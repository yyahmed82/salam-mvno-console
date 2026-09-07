# Changelog

All notable changes to the Salam MVNO Digital Console are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/); this project uses [SemVer](https://semver.org/).

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
