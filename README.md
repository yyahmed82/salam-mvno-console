# Salam DMS · MVNO Digital Console

Interactive operations console for the **selfcare-backend** (release-2.34.1), generated from full static code analysis.

**Open `index.html` in a browser** — no server needed.

## Views
1. **System Topology** — 43 nodes / 56 flows: channels, Rails core, Optiva BSS, Nafath, payment rails, delivery vendors, ZATCA, messaging. Filter by flow type; click any node for its flows.
2. **Journey Player** — step through one journey with auto-play.
3. **Journeys Explorer** — all 24 user journeys (167 steps) with per-step sequence diagrams, exact endpoints, controllers, services, DB tables, AASM state transitions, and a Success/Failure toggle.
4. **Integrations & Workers** — 32 external systems, 15 inbound webhooks, 43 Sidekiq workers on 22 queues, cron jobs.

## Source analysis (analysis/)
- `journeys.md` — every journey end-to-end + full route inventory + state machines
- `integrations.md` — integration catalogue, webhooks, workers, topology adjacency list
- `data-model.md` — ~40 core entities, enums/vendor values, ER graph, prod volumes

## API samples & official docs (click any endpoint)
Click a blue call-arrow in a sequence diagram, or the endpoint code line, to open a modal with:
- **Request / response sample** — 171 curated endpoints (`samples.js` + `samples2.js`), PII synthetic/masked.
- **Official API documentation** — for the documented Apollo/Sedco partner endpoints, parsed from the app's own Slate reference (`vendor/api-docs/index.html`) into `apidocs.js`: method+path, params table, real curl request, response, 15 global error codes, and a deep link to the live doc anchor (`staging-proxy.salammobile.sa/api-docs/#<section>`).

## Files
- `index.html` — shell + styles
- `data.js` — topology, integrations, workers data
- `data2.js` — journeys data (the step definitions that drive the diagrams)
- `samples.js` / `samples2.js` — per-endpoint request/response samples
- `apidocs.js` — parsed official Apollo/Sedco API reference + error codes
- `app.js` — renderers (topology SVG, sequence diagrams, player, catalogue, sample+doc modal)

To update: edit the data files — the diagrams are generated from them at load time.
