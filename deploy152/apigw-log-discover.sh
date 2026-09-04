#!/usr/bin/env bash
# APIGW APPLICATION-LOG DISCOVERY — run ON each gateway node (172.31.42.25 … 172.31.42.28).
#
#   bash apigw-log-discover.sh            # writes /tmp/apigw-logdiscover-<host>.txt
#
# WHY: L2 (2 Sep 2026) says the APIGW application logs correlate with the console via the
# transaction id (uilTransactionId). Before building any collector we need the ground truth:
# which services live under /opt/application, what each writes, in what format, with what
# retention, and WHICH id field actually appears in the lines. This script answers exactly
# that and nothing more.
#
# STRICTLY READ-ONLY & BOUNDED:
#   · never writes outside /tmp; never touches the service dirs beyond ls/du/head/tail
#   · samples are tail/head windows only (no full-file scans of GB logs)
#   · every sampled line is MASKED before it is written: digit runs of 7+ keep last 3 only
#   · safe to run on a live node at any time of day
set -uo pipefail
BASE=/opt/application
OUT=/tmp/apigw-logdiscover-$(hostname -s).txt
MASK='s/[0-9]\{7,\}/***&/g; s/\*\*\*[0-9]\{4,\}\([0-9]\{3\}\)/***\1/g'
say(){ echo "$@" | tee -a "$OUT" >/dev/null; }
: > "$OUT"

say "== APIGW LOG DISCOVERY · $(hostname) ($(hostname -I 2>/dev/null | awk '{print $1}')) · $(date -u +%FT%TZ) =="
say ""
say "-- 1. services under $BASE --"
if [ ! -d "$BASE" ]; then say "!! $BASE does not exist on this node"; cat "$OUT"; exit 0; fi
for d in "$BASE"/*/; do
  [ -d "$d" ] || continue
  sz=$(du -sh "$d" 2>/dev/null | cut -f1)
  say "  $(basename "$d")  ·  $sz  ·  logs dir: $([ -d "$d/logs" ] && echo yes || echo NO)"
done

say ""
say "-- 2. per-service log inventory (files · size · oldest → newest = retention) --"
for d in "$BASE"/*/logs; do
  [ -d "$d" ] || continue
  svc=$(basename "$(dirname "$d")")
  n=$(find "$d" -maxdepth 1 -type f 2>/dev/null | wc -l)
  oldest=$(find "$d" -maxdepth 1 -type f -printf '%T@ %f\n' 2>/dev/null | sort -n | head -1 | cut -d' ' -f2-)
  newest=$(find "$d" -maxdepth 1 -type f -printf '%T@ %f\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)
  say ""
  say "[$svc] $n file(s) · oldest: ${oldest:-—} · newest: ${newest:-—}"
  ls -lht "$d" 2>/dev/null | head -12 | sed 's/^/    /' | tee -a "$OUT" >/dev/null
done

say ""
say "-- 3. format + correlation-id sample per distinct log (masked; tail windows only) --"
for d in "$BASE"/*/logs; do
  [ -d "$d" ] || continue
  svc=$(basename "$(dirname "$d")")
  # one representative per base name (foo.log, foo.2026-09-01.log → 'foo'), newest first
  find "$d" -maxdepth 1 -type f \( -name '*.log' -o -name '*.out' -o -name '*.txt' \) -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn | cut -d' ' -f2- \
    | awk -F/ '{f=$NF; sub(/[._-][0-9]{4}[-.0-9]*/,"",f); sub(/\.(log|out|txt).*/,"",f); if(!seen[f]++) print}' \
    | head -8 | while read -r f; do
      say ""
      say "### $svc / $(basename "$f")  ($(du -h "$f" 2>/dev/null | cut -f1))"
      say "  -- last 4 lines (masked) --"
      tail -4 "$f" 2>/dev/null | cut -c1-400 | sed "$MASK" | sed 's/^/  | /' | tee -a "$OUT" >/dev/null
      say "  -- id fields in last 3000 lines --"
      tail -3000 "$f" 2>/dev/null | grep -oiE 'uil[A-Za-z]*[Tt]ransaction[Ii]d|transaction[-_]?[Ii]d|trace[-_]?[Ii]d|x-request-id|correlation[-_]?[Ii]d|requestId' \
        | tr 'A-Z' 'a-z' | sort | uniq -c | sort -rn | head -6 | sed 's/^/  /' | tee -a "$OUT" >/dev/null
      # shape check: how do the ids look? (masked to shape only)
      say "  -- sample id values (shape only) --"
      tail -3000 "$f" 2>/dev/null | grep -oiE '(uil)?transaction[-_]?id["=: ]+[A-Za-z0-9-]{8,40}' | head -3 \
        | sed -E 's/[0-9]/9/g; s/[a-f]/x/g' | sed 's/^/  | /' | tee -a "$OUT" >/dev/null
    done
done

say ""
say "-- 4. summary hints --"
say "  · a service whose lines carry uilTransactionId / transactionId can be JOINED to the console's"
say "    api_traffic_events.transaction_id and apigw traces — that is the collector-worthy set."
say "  · retention = oldest file above; that bounds how far back any correlation can ever reach."
say ""
say "== done. Send this file back: $OUT =="
cat "$OUT"
