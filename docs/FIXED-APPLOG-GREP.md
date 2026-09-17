# Fixed › Troubleshoot — "Grep the app log" (17 Sep 2026)

## The gap this closes

`https://salam.sa/unified-console/#fixed?tab=errors` searches **read models**, not logs:

| feed | what it holds | what it drops |
|---|---|---|
| `sda_ops` / `sda_ops_beta` error events (the board) | failed journeys, the fields the ingest parses | every success; every field the ingest does not parse |
| `fixed_app_events` (the app-log lane) | failed steps + the six providers, masked | every success; request / response bodies; every other field |

So a customer id that answers instantly on the node —

```
grep -rn '1054887433' /app/log/sda/combined.log
```

— answers **"No errors in this window"** in the console. The raw line carries far more than either read
model keeps: `channel, forwardedFor, ip, level, message, path, platform, rawInput, request, response,
requestId, service, source, staffId, timestamp, type, version`, and inside those `dealerId, custCode,
custID, iccid, imsi, msisdn, operatorTCN, personId`.

## What was added

`server/src/fixedLogGrep.js` + `fixed-grep.js` — a grep panel on the error board, **beside** the existing
filters. Nothing existing changed: the board, its windows, its identifier boxes, the class / team /
priority / provider / channel / type chips, the message select, the export and the app-log lane are all
untouched, and the grep never runs on the 60 s auto-refresh.

* **Any field, any term.** Free text matched against the whole log line — customer id, national id,
  MSISDN, ICCID, IMSI, custCode, order no, plate, staff id, requestId, or an error phrase
  (`does not match NIC records`). `grep -F` by default, `grep -E` when *regular expression* is ticked.
* **Successes and failures.** The panel reports what the line says — `ok` / `fail` / *no verdict* for a
  Request line that has no outcome of its own — instead of keeping only what failed.
* **The whole case, not the matching line.** A term matches only the lines that literally carry it, so a
  customer id finds the validate step but not the `mutation … success 936ms` verdict that followed. A
  second pass greps the `requestId`s the first pass found (all of them in one pass — `grep -F` treats a
  newline-separated pattern as a list) and merges the journeys. Lines pulled in this way are marked
  *via requestId*. Capped at 12 ids, skipped if the first pass used most of the time budget, never fatal.
* **Request / response in the same UI as the board rows.** One table row per case (time · outcome · what ·
  channel / path · identifiers · steps), expanding into the steps in log order, each with its Request,
  Response, Raw input and the raw JSON line on demand.

## Prod safety on 146

* **Explicit action only.** A person presses Search. Never scheduled, never on a refresh.
* **Staged.** The current `combined.log` only. Rotated / `.gz` siblings are searched only when *include
  rotated files* is ticked.
* `nice -n 19` + `ionice -c3`, a hard remote `timeout` (50 s — under nginx's 60 s), per-file newest-N line
  cap, 20 000 characters per line, a 3 MB output cap, and a 56 s ssh timeout. `timeout`, `ionice` and
  `zgrep` are each probed, never assumed — a missing one degrades, it never silently returns nothing.
* **Credentials masked on the node**, before anything crosses the wire: Nafath `iamAppToken` JWTs,
  `apiKey`, `password`, `authorization`, `wsse:Password`.
* **Customer data is not masked** — the same decision as the DMS log grep (3 Sep): Troubleshoot is
  L2-gated and L2 reads this exact file raw on the node. The route is gated on the `fixed` view and
  **every search is written to the audit log** (`fixed.applog.grep`, with the term).
* **The term never reaches the remote shell as text.** It is base64-encoded here and decoded into a
  variable there, so no quote, metacharacter or newline can escape. Verified:
  `'; touch /tmp/PWNED; echo '` searches for that literal string and creates nothing.
* Identical lines from an overlapping rotated file are de-duplicated by content hash.

## Where it is

* Panel: the error board, above the app-log lane. Collapsed until *Open grep*; prefilled from whatever is
  already typed in the board's search boxes. When the board finds nothing, its empty state offers
  **🔎 Grep the app log for `<term>`**, which opens the panel and runs the search.
* API: `GET /api/fixed/applog/grep?q=&deep=&regex=&limit=&expand=` and `/api/fixed/applog/grep/status`.
* CLI on 152: `cd /apps/unified/server && node src/fixedLogGrep.js <term> [--deep] [--regex] [--limit N]`.
* Env (all optional — host, user, key and path come from the collector's `FIXED_LOG_*`):
  `FIXED_GREP=0` disables · `FIXED_GREP_REMOTE_SECS` (50) · `FIXED_GREP_TIMEOUT_MS` (56000) ·
  `FIXED_GREP_MAX_LINES` (1000) · `FIXED_GREP_CAP_MB` (3).

## Tested before deploy (offline, against a fixture of the real line shapes)

Shell injection (no file created, the string is searched literally) · terms with spaces · regex mode and
a rejected invalid regex · minimum length · no-match wording · rotated `.gz` search and de-duplication ·
the second pass pulling in a `mutation … success` line that does **not** carry the search term ·
unconfigured / disabled paths · and the panel rendered headless at 1440 / 834 / 390 px and in dark mode:
no JS errors, no horizontal page scroll, expanded detail readable on a phone.
