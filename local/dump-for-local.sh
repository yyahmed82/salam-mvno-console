#!/usr/bin/env bash
# dump-for-local.sh — build a TIME-SCOPED offline snapshot of the console's data, for a laptop.
# RUN ON 152 (ruh-salam-site03, 172.31.38.152) as root:
#     bash /apps/unified/local/dump-for-local.sh [DAYS] [OUTDIR]
#     DAYS   how much history to take from the read-only source DBs (default 30)
#     OUTDIR where the archives are written               (default /tmp/console-local)
#
# WHAT IT TAKES
#   console.dump   the console's OWN database, COMPLETE — rules, users, settings, incidents,
#                  metric snapshots, runbooks, llm_calls, tickets. Small, and it is the part that
#                  makes the local console *yours* rather than empty.
#   source.dump    only the tables the console actually reads, each cut to the last DAYS days.
#   ops.dump       Fixed read model (sda_ops)          — only if OPS_DATABASE_URL is set
#   opsbeta.dump   Fixed B2C read model (sda_ops_beta) — only if OPS_BETA_DATABASE_URL is set
#
# READ-ONLY on every prod database except one scratch schema (local_snap) it creates and drops in
# the SOURCE/OPS databases. If that role may not create a schema, see NO-WRITE at the end.
set -euo pipefail

DAYS="${1:-30}"
OUT="${2:-/tmp/console-local}"
ENV_FILE="${ENV_FILE:-/apps/unified/.env}"
[ -f "$ENV_FILE" ] || { echo "no env at $ENV_FILE"; exit 1; }
set -a; . "$ENV_FILE"; set +a
mkdir -p "$OUT"

# every table the console reads from the source replica (metrics.js + alertCases.js)
SRC_TABLES="activation_logs,eligibility_logs,nafath_logs,change_plan_logs,delivery_requests,onboarding_orders,otps,payments,checkouts,seller_deductions,api_error_events,api_traffic_events,apigw_probe_log,sms_probe_events,incident_log"
OPS_TABLES="order_attempts,error_events,api_calls,api_logs,workflow_states,dealers,fixed_error_acks,fixed_playbook_overrides,ops_docs"

say(){ printf '\n== %s ==\n' "$*"; }

say "1/4  console DB (complete)"
psql "$CONSOLE_DATABASE_URL" -Atc "SELECT pg_size_pretty(pg_database_size(current_database()))" | sed 's/^/     size: /'
pg_dump -Fc --no-owner --no-privileges -d "$CONSOLE_DATABASE_URL" -f "$OUT/console.dump"
ls -lh "$OUT/console.dump" | awk '{print "     wrote " $9 " (" $5 ")"}'

snap() {                       # snap <label> <url> <table-csv>
  local label="$1" url="$2" tables="$3" arr
  [ -n "$url" ] || { echo "     (skipped - not configured)"; return 0; }
  arr="ARRAY[$(echo "$tables" | sed "s/[^,]*/'&'/g")]"

  psql "$url" -v ON_ERROR_STOP=1 -q -c "DROP SCHEMA IF EXISTS local_snap CASCADE; CREATE SCHEMA local_snap;"
  psql "$url" -Atc "
    SELECT format('CREATE TABLE local_snap.%I AS SELECT * FROM public.%I%s;', c.relname, c.relname,
      CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns col
                         WHERE col.table_schema='public' AND col.table_name=c.relname
                           AND col.column_name='created_at')
           THEN ' WHERE created_at >= now() - interval ''DAYSPLACEHOLDER days'''
           ELSE '' END)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname = ANY($arr)
    ORDER BY 1" | sed "s/DAYSPLACEHOLDER/$DAYS/" > "$OUT/.snap_${label}.sql"

  echo "     tables in this snapshot:"; sed 's/^/       /' "$OUT/.snap_${label}.sql" | cut -c1-95
  psql "$url" -v ON_ERROR_STOP=1 -q -f "$OUT/.snap_${label}.sql"
  psql "$url" -Atc "SELECT pg_size_pretty(coalesce(sum(pg_total_relation_size(c.oid)),0))
                      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                     WHERE n.nspname='local_snap'" | sed 's/^/     snapshot size: /'
  pg_dump -Fc --no-owner --no-privileges -n local_snap -d "$url" -f "$OUT/${label}.dump"
  psql "$url" -q -c "DROP SCHEMA IF EXISTS local_snap CASCADE;"
  rm -f "$OUT/.snap_${label}.sql"
  ls -lh "$OUT/${label}.dump" | awk '{print "     wrote " $9 " (" $5 ")"}'
}

say "2/4  source replica - last $DAYS days of the tables the console reads"
snap source "${SOURCE_DATABASE_URL:-}" "$SRC_TABLES"
say "3/4  Fixed read model (sda_ops)"
snap ops "${OPS_DATABASE_URL:-}" "$OPS_TABLES"
say "4/4  Fixed B2C read model (sda_ops_beta)"
snap opsbeta "${OPS_BETA_DATABASE_URL:-}" "$OPS_TABLES"

say "DONE"
du -sh "$OUT"
echo
echo "Now copy it to your Mac - run this ON THE MAC:"
echo "    scp -r ruh-salam-site03:$OUT ~/Downloads/console-local"
echo
echo "NO-WRITE: if the source role may not CREATE SCHEMA, ask the DBA to run the snap step, or"
echo "dump whole tables instead:  pg_dump -Fc -t activation_logs -t payments ... -d \$SOURCE_DATABASE_URL"
