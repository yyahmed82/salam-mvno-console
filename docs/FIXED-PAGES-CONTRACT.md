# Fixed sub-pages — builder contract (unified console)

Frontend hub: `fixed.js` (tab bar, shared channel/range state, `window.FX` helpers). Each page = ONE file `fixed-<key>.js`
at repo root, loaded by `index.html` after `fixed.js`. It must register:

```js
(function(){ "use strict";
  const FX = () => window.FX;                       // { api, esc, ts, fmt, tbl, card, chip, bar, state:{range,channel}, qs(), OUT_COLOR, KSA, rerender }
  async function render(host, fx){ /* host = #fxPage element; idempotent; draw everything inside host */ }
  window.FIXED_PAGES = window.FIXED_PAGES || {};
  window.FIXED_PAGES.<key> = { label: "…", render };
})();
```
Keys (fixed): overview · map · qr · dash · errors · alerts · playbook · diagrams · report.
`fx.qs()` gives `range=7d[&channel=sda]` for the shared filter; `fx.api(path)` fetches with session headers and throws on error.
No build step: vanilla JS, `node --check` must pass. Use existing CSS classes (`.stat`, `.topo-card`, `.pill`, `.btn`, `.albanner`, `.mono`, `.rl`)
and CSS vars (`--card --line --muted --green`). Dark theme is automatic through the vars. Never hard-code `/digital-console` or
`/unified-console` — use `window.API_BASE`. Google Maps: key from `GET /api/fixed/config` (`mapsKey`), load
`https://maps.googleapis.com/maps/api/js?key=…&libraries=marker` + `https://cdnjs.cloudflare.com/ajax/libs/…markerclusterer…` lazily;
if `mapsKey` is null render the SVG-KSA fallback (see `dms.js` map section).

Backend: ONE file `server/src/fixed<Key>.js` exporting `mount(app, deps)` with
`deps = { gate /* requireView('fixed') middleware */, wrap /* (fn(q, req)) → express handler with JSON + error mapping */, audit, requireCap, db, f360, roles }`.
Routes MUST be under `/api/fixed/<key>/…` and use `gate`. Data: `db.ops` (prod `sda_ops.public`: dealers, order_attempts,
api_calls, error_events, alert_rules, alert_events, alert_rule_revisions, incident_log, ops_docs, ingest_state, users, audit_log),
`db.opsBeta` (beta schema, Salam Home app rows), `db.nexus` (live unmask only), `db.payments`. Read-only, parameterised SQL, small
LIMITs, `statement_timeout` is 15 s. Reuse `f360.parseScope(q)` for the window/channel/consumer-direct scope (returns
`{ from, to, where, params }` with alias `oa` for order_attempts LEFT JOIN dealers d). PII: identifiers → last digits only
(`tail()` pattern in fixed360.js) unless `req.caps.unmaskPII` AND `q.unmask==='1'`, and then `audit(req,'pii.unmask',…)`.
Port the SQL 1:1 from salam-dealer-ops `packages/api/src/routers/*.ts` so numbers match the prod console.
