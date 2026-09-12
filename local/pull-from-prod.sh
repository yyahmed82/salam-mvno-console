#!/usr/bin/env bash
# pull-from-prod.sh — build a time-scoped OFFLINE COPY of the console's data. RUNS ON THE MAC.
#
#     bash local/pull-from-prod.sh [DAYS] [OUTDIR]
#       DAYS    history taken from every append-only table   (default 30)
#       OUTDIR  where the snapshot is written                (default ~/Downloads/console-local)
#
# WHY IT RUNS ON THE MAC
#   152 (ruh-salam-site03) has NO PostgreSQL client at all - no psql, no pg_dump, no libpq package.
#   Your Mac has one. So this script opens an SSH tunnel to the DB host through 152 and lets the
#   Mac's own psql/pg_dump do the work.
#
# STRICTLY READ-ONLY ON PROD
#   Every prod session runs with default_transaction_read_only=on. Nothing is created, no scratch
#   schema, no temp table. Data leaves through \copy (SELECT ...) TO a local CSV; DDL through
#   pg_dump --schema-only. 152 only forwards TCP.
#
# WHAT IT TAKES                                              -> restored by local/restore-local.sh as
#   console/   unified_console  (172.31.15.121) full DDL + data, heavy tables cut to DAYS
#                                                              -> unified_console_local
#   source/    salam_replica    (172.31.15.121) the tables the console reads, cut to DAYS
#                                                              -> salam_source_local
#   ops/       sda_ops schema public  (172.31.15.121)        -> sda_ops_local  schema public
#   opsbeta/   sda_ops schema beta    (same database!)       -> sda_ops_local  schema beta
set -euo pipefail

DAYS="${1:-30}"
OUT="${2:-$HOME/Downloads/console-local}"
ONLY="${ONLY:-}"                 # e.g. ONLY=ops,opsbeta to redo just those two
SSH_HOST="${SSH_HOST:-yosri@ruh-salam-site03}"
CRED="${CRED:-$HOME/.salam-prod-db.env}"
STMT_TIMEOUT_MS="${STMT_TIMEOUT_MS:-1800000}"   # 30 min: sda_ops has 17 GB tables and the role's
                                                # own statement_timeout cancelled the big \copy
export PGOPTIONS="-c timezone=UTC -c default_transaction_read_only=on -c statement_timeout=$STMT_TIMEOUT_MS"
export PGCONNECT_TIMEOUT=10

say(){ printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
die(){ echo "ERROR: $*" >&2; exit 1; }

command -v psql    >/dev/null || die "psql not on PATH (brew install libpq && brew link --force libpq)"
command -v pg_dump >/dev/null || die "pg_dump not on PATH"
[ -f "$CRED" ] || die "no credentials at $CRED
  Create it once (one sudo prompt on 152, read-only):
    ssh $SSH_HOST 'sudo cat /apps/unified/.env' | grep -E '^(CONSOLE|SOURCE|OPS|OPS_BETA)_DATABASE_URL=' > $CRED
    chmod 600 $CRED"
set -a; . "$CRED"; set +a

# ---------- tables ---------------------------------------------------------------------------
SRC_TABLES="activation_logs eligibility_logs nafath_logs change_plan_logs delivery_requests onboarding_orders otps payments checkouts seller_deductions api_error_events api_traffic_events apigw_probe_log sms_probe_events incident_log"
OPS_TABLES="order_attempts error_events api_calls api_logs workflow_states dealers fixed_error_acks fixed_playbook_overrides ops_docs"
# console tables that grow forever - taken only for the last DAYS. Everything else comes whole.
CONSOLE_HEAVY="metric_snapshots api_error_events api_traffic_events apigw_probe_log apigw_slow_spans apigw_trace_stats sms_probe_events dms_journey_events rollup_hourly rollup_vendor_hourly live_snapshots ops_events audit_log console_ticket_files console_sessions login_otps alert_reminders alerts llm_calls llm_budget_events assist_cases assist_feedback console_errors"
TSCOLS="created_at,occurred_at,captured_at,event_time,started_at,at,ts,hour,day,bucket"

# ---------- tunnel ---------------------------------------------------------------------------
LFWD=""            # bash 3.2 on macOS: no associative arrays, so a plain "host:port=localport" map
MAP=""
NEXT=15432
portof(){ printf '%s\n' "$MAP" | awk -F= -v k="$1" '$1==k{print $2; exit}'; }
local_url(){                                   # local_url <prod-url> <local-port>
  python3 - "$1" "$2" <<'PY'
import sys, urllib.parse as u
raw, port = sys.argv[1], sys.argv[2]
p = u.urlsplit(raw)
# The prod passwords contain an unencoded '@'. urlsplit does split on the LAST '@', but the
# parts must be re-encoded or libpq mis-parses them - and psql rejects the Prisma-only params
# (schema / connection_limit / pool_timeout), so drop them here.
# decode first: the OPS URLs store the password already percent-encoded, and encoding it a
# second time turned %2F into %252F -> "password authentication failed".
user = u.quote(u.unquote(p.username or ''), safe='')
pwd  = u.quote(u.unquote(p.password or ''), safe='')
auth = (user + (':' + pwd if pwd else '') + '@') if user else ''
q = [(k, v) for k, v in u.parse_qsl(p.query, keep_blank_values=True)
     if k not in ('schema', 'connection_limit', 'pool_timeout', 'pgbouncer', 'connect_timeout')]
print(u.urlunsplit((p.scheme, auth + '127.0.0.1:' + port, p.path, u.urlencode(q), '')))
PY
}
hostport(){ python3 - "$1" <<'PY'
import sys,urllib.parse as u
p=u.urlsplit(sys.argv[1]); print("%s:%s"%(p.hostname,p.port or 5432))
PY
}
for v in CONSOLE_DATABASE_URL SOURCE_DATABASE_URL OPS_DATABASE_URL OPS_BETA_DATABASE_URL; do
  eval "url=\${$v:-}"; [ -n "$url" ] || continue
  hp="$(hostport "$url")"
  if [ -z "$(portof "$hp")" ]; then
    MAP="$MAP$hp=$NEXT
"
    LFWD="$LFWD -L $NEXT:$hp"
    NEXT=$((NEXT+1))
  fi
done
[ -n "$LFWD" ] || die "no *_DATABASE_URL found in $CRED"

say "SSH tunnel via $SSH_HOST"
printf '%s' "$MAP" | awk -F= 'NF{print "   127.0.0.1:"$2"  ->  "$1}' 
CTL="$(mktemp -u /tmp/salam-tun.XXXXXX)"
ssh -f -N -M -S "$CTL" -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 $LFWD "$SSH_HOST"
cleanup(){ ssh -S "$CTL" -O exit "$SSH_HOST" 2>/dev/null || true; }
trap cleanup EXIT
sleep 1

mkdir -p "$OUT"

# ---------- one dataset ----------------------------------------------------------------------
pull(){                          # pull <label> <prod-url-var> <schema> <tables|ALL>
  local label="$1" var="$2" schema="$3" want="$4"
  if [ -n "$ONLY" ]; then
    case ",$ONLY," in *",$label,"*) ;; *) echo "   (skipped - not in ONLY=$ONLY)"; return 0;; esac
  fi
  local prod="${!var:-}"
  [ -n "$prod" ] || { echo "   (skipped - $var not set)"; return 0; }
  local url; url="$(local_url "$prod" "$(portof "$(hostport "$prod")")")"
  local dir="$OUT/$label"; mkdir -p "$dir"

  psql "$url" -Atc "SELECT 1" >/dev/null || die "$label: cannot reach the database through the tunnel"
  psql "$url" -Atc "SELECT current_database()||'  '||pg_size_pretty(pg_database_size(current_database()))" | sed 's/^/   live: /'

  local tables
  if [ "$want" = "ALL" ]; then
    tables="$(psql "$url" -Atc "SELECT tablename FROM pg_tables WHERE schemaname='$schema' ORDER BY 1")"
  else
    tables="$(psql "$url" -Atc "SELECT tablename FROM pg_tables WHERE schemaname='$schema' AND tablename = ANY(string_to_array('$(echo $want | tr ' ' ',')',',')) ORDER BY 1")"
  fi
  [ -n "$tables" ] || { echo "   no matching tables in schema $schema"; return 0; }

  # DDL (read-only): schema + indexes + constraints for exactly these tables
  local targs=(); for t in $tables; do targs+=(-t "$schema.$t"); done
  pg_dump --schema-only --no-owner --no-privileges -n "$schema" "${targs[@]}" -d "$url" > "$dir/schema.sql"
  echo "   DDL: $(wc -l < "$dir/schema.sql" | tr -d ' ') lines"

  : > "$dir/manifest.txt"
  for t in $tables; do
    local scoped="" col=""
    if [ "$want" = "ALL" ]; then
      case " $CONSOLE_HEAVY " in *" $t "*) scoped=1;; esac
    else scoped=1; fi
    if [ -n "$scoped" ]; then
      col="$(psql "$url" -Atc "
        SELECT column_name FROM information_schema.columns
         WHERE table_schema='$schema' AND table_name='$t'
           AND column_name = ANY(string_to_array('$TSCOLS',','))
           AND data_type LIKE 'timestamp%'
         ORDER BY array_position(string_to_array('$TSCOLS',','), column_name) LIMIT 1")"
    fi
    local q="SELECT * FROM \"$schema\".\"$t\""
    [ -n "$col" ] && q="$q WHERE \"$col\" >= (now() at time zone 'UTC') - interval '$DAYS days'"
    if ! psql "$url" -q -c "\\copy ($q) TO '$dir/$t.csv' CSV HEADER"; then
      printf '     %-34s %s\n' "$t" "FAILED - skipped (re-run with a smaller DAYS or a bigger STMT_TIMEOUT_MS)"
      rm -f "$dir/$t.csv"
      continue
    fi
    local rows sz
    rows=$(( $(wc -l < "$dir/$t.csv") - 1 )); [ "$rows" -lt 0 ] && rows=0
    sz=$(du -h "$dir/$t.csv" | cut -f1)
    printf '%s\n' "$t" >> "$dir/manifest.txt"
    printf '     %-34s %10s rows %8s %s\n' "$t" "$rows" "$sz" "${col:+(last $DAYS d on $col)}"
  done
  echo "   $label total: $(du -sh "$dir" | cut -f1)"
}

say "1/4  console DB  (unified_console - all tables, heavy ones cut to $DAYS days)"
pull console  CONSOLE_DATABASE_URL  public ALL
say "2/4  source replica  (last $DAYS days of what the console reads)"
pull source   SOURCE_DATABASE_URL   public "$SRC_TABLES"
say "3/4  Fixed read model  sda_ops / schema public"
pull ops      OPS_DATABASE_URL      public "$OPS_TABLES"
say "4/4  Fixed B2C read model  sda_ops / schema beta   (SAME database, other schema)"
pull opsbeta  OPS_BETA_DATABASE_URL beta   "$OPS_TABLES"

say "DONE  -  $(du -sh "$OUT" | cut -f1) in $OUT"
echo "next:  bash local/restore-local.sh \"$OUT\""
