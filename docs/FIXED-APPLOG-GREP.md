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

## v2 — what the first live run on 146 taught (same day)

The first production search reported **`219 matching lines · 0 returned · 0 cases · 50.3 s`**. The count
was right and every line was lost, which says exactly what went wrong: v1 counted with `zgrep -c` and then
re-read the file to print the lines — **two full passes over a multi-GB log**. The first pass spent the
whole 50 s budget, the remote `timeout` killed the second, and only the `@@FILE` count survived.

Three changes, in order of how much they matter:

1. **One pass.** `grep` now feeds an `awk` ring buffer that keeps the newest N lines *and* the true total
   count, so the file is read once. Measured on a 35 MB fixture: 30 001 matches counted and the newest 100
   returned in 32 ms.
2. **Read from the end.** The log is chronological and operators search recent cases, so the default reads
   only the last 512 MB via `tail -c`, which **seeks** — the earlier gigabytes are never touched. Depth is
   an explicit control (256 MB · 512 MB · 2 GB · whole current log · whole + rotated) and every answer
   states the file size, the bytes actually read and the **oldest timestamp inside the window**, so "no
   match" is never mistaken for "not in the log". An empty shallow window offers the next depth in one
   click.
3. **No 60 s wall.** nginx cuts a proxied request at 60 s, which capped any honest whole-file or rotated
   search. The search now runs as a **background job** the page polls (phase + elapsed shown, "stop
   waiting" available), so the deep depths get `FIXED_GREP_DEEP_SECS` (240 s) instead of being killed
   half way.

Two further guards came with it: **one search at a time per host** (a second identical search joins the
running one instead of doubling the IO on a live app node) and a **short result cache** (180 s), so a
re-ask or a second engineer looking at the same case does not re-read the log.

## Prod safety on 146

* **Explicit action only.** A person presses Search. Never scheduled, never on a refresh.
* **Staged.** The tail window of the current `combined.log` by default; the whole file and the rotated
  `.gz` siblings only at the depth the operator picks.
* `nice -n 19` + `ionice -c3`, a hard remote `timeout` (50 s windowed / 240 s deep), newest-N lines per
  file, 20 000 characters per line, a 3 MB output cap, ssh timeout above the remote one. `timeout`,
  `ionice`, `stat` and `zcat` are each probed, never assumed — a missing one degrades, it never silently
  returns nothing.
* **Credentials masked on the node**, before anything crosses the wire: Nafath `iamAppToken` JWTs,
  `apiKey`, `password`, `authorization`, `wsse:Password`.
* **Customer data is not masked** — the same decision as the DMS log grep (3 Sep): Troubleshoot is
  L2-gated and L2 reads this exact file raw on the node. The route is gated on the `fixed` view and
  **every search is written to the audit log** (`fixed.applog.grep`, with the term).
* **The term never reaches the remote shell as text.** The term, the file list and the awk program are
  base64-encoded here and decoded into variables there, so no quote, metacharacter or newline can escape.
  Verified: `'; touch /tmp/PWNED; echo '` searches for that literal string and creates nothing.
* Identical lines from an overlapping rotated file are de-duplicated by content hash.

## Where it is

* Panel: the error board, above the app-log lane. Collapsed until *Open grep*; prefilled from whatever is
  already typed in the board's search boxes. When the board finds nothing, its empty state offers
  **🔎 Grep the app log for `<term>`**, which opens the panel and runs the search.
* API: `GET /api/fixed/applog/grep?q=&depth=&regex=&limit=&expand=&async=1` → `{id}`;
  `GET /api/fixed/applog/grep/job?id=` polls; `GET /api/fixed/applog/grep/status`.
  Without `async=1` the route still answers synchronously (CLI / scripts), subject to nginx's 60 s.
* CLI on 152: `cd /apps/unified && set -a && . ./.env && set +a && node server/src/fixedLogGrep.js <term>
  [--depth recent|window|wide|full|all] [--regex] [--limit N] [--no-expand]`.
* Env (all optional — host, user, key and path come from the collector's `FIXED_LOG_*`):
  `FIXED_GREP=0` disables · `FIXED_GREP_TAIL_MB` (512, the default window) · `FIXED_GREP_REMOTE_SECS` (50)
  · `FIXED_GREP_DEEP_SECS` (240) · `FIXED_GREP_MAX_LINES` (1000) · `FIXED_GREP_CAP_MB` (3) ·
  `FIXED_GREP_CACHE_SEC` (180) · `FIXED_GREP_JOB_TTL_MIN` (15).

## Tested before deploy (offline, against a 35 MB / 120 000-line fixture of the real line shapes)

Shell injection (no file created, the string is searched literally) · terms with spaces · regex mode and a
rejected invalid regex · minimum length · rotated `.gz` search and de-duplication · the second pass pulling
in a `mutation … success` line that does **not** carry the search term · a term present only *before* the
window (correct "covers back to …, search deeper" wording) · 30 001 matches counted with the newest 100
returned in one pass · job polling, identical-search join, result cache, unknown job id · unconfigured /
disabled paths · and the panel driven headless through start → poll → render at 1440 / 834 / 390 px and in
dark mode: no JS errors, no horizontal page scroll, expanded detail readable on a phone, and the
"search deeper" button re-running at the next depth.

## If it is still slow on 146

The honest lever is the window, not the code: a 512 MB read at ~150 MB/s is ~3 s, a 10 GB read is a
minute. If whole-log searches become routine, the next step is not a faster grep — it is to widen what
`fixedAppLogCollector` keeps (it already tails this file every 2 minutes with a byte watermark), so the
common lookups are answered from `fixed_app_events` in Postgres and the grep stays for the long tail.
