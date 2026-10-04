# Mobile › Journeys — BSS gateway calls from the backend code

`rbcalls.py` reads the Digital selfcare backend (Rails) source and writes `journeyDownstream.js` at the web
root. Mobile › Journeys uses it to show, for every journey step, the BSS gateway calls (APIGW `…/api/uil` +
path — the same paths the `api_traffic_events` collector logs) that the step reaches in code, with the call
chain, and to answer "where is this gateway call made?" from the search box.

## Regenerate (on the Mac, after a new backend release)

```
cd ~/Documents/Claude/Projects/"Salam DMS"/unified-console && GEN_DATE=$(date +%F) SRC_DATE=$(date +%F) SRC_LABEL="selfcare-backend working copy (Mac)" python3 tools/journeys/rbcalls.py ../selfcare-backend/app
```

Defaults: journeys from `data2.js`, output `journeyDownstream.js` (both at the repo root). Needs `python3` and
`node`. Files that iCloud has offloaded cannot be read — open the `selfcare-backend` folder in Finder and
choose "Download Now" first, or the calls inside those files are missing from the map. The output is
deterministic (same source → same file), so a diff of `journeyDownstream.js` shows exactly what changed.

## What it resolves

Static analysis, every branch: a listed call can happen from that step; the code's conditions decide whether
it does. An edge is created only when the receiver class is known:

- `Cls.new(…).m`, `Cls.new_from_x(…).m`, `Cls.m` (class method), typed locals / ivars (`v = Cls.new…`,
  `@v ||= Cls.new`), memo helpers (`def client; @client ||= Cls.new; end`), Rails-named receivers
  (`@onboarding_order` → `OnboardingOrder`, models only)
- `XWorker.perform_async / perform_in / perform_at` → `XWorker#perform` (shown as "Background job · queue …")
- bare and `self.` calls inside a class, its parents and included concerns
- controller `before_action` / `skip_before_action` (`only:` / `except:`)
- model hooks (`before_/after_ create|save|destroy|update|commit`) through `has_one / has_many / belongs_to`
  receivers — e.g. `order.number.destroy` → `Number#~destroy` → `before_destroy :cleanup`
- AASM events (`event :e, after_commit: :cb`, `after do … end`) → `Cls#e` / `e!`
- unique-name fallback (`recv.m`, `m` ≥ 8 characters and defined once) — flagged **inferred**

Not followed: dynamic dispatch (`constantize`, `send`, `public_send`), so payment-vendor clients selected at
run time appear as "No static caller found". The BSS adapter module is shown as `Oracle::` like the rest of
Mobile › Journeys. No secrets are read into the output — only class / method names and gateway paths.
