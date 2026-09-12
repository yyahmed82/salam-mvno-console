#!/usr/bin/env bash
# restore-local.sh — load the snapshot into the Postgres ON YOUR MAC. RUNS ON THE MAC.
#     bash local/restore-local.sh [~/Downloads/console-local]
#
# Creates / replaces three local databases:
#     unified_console_local   the console's own DB - rules, users, settings, incidents, snapshots
#     salam_source_local      scoped copy of the source replica (salam_replica)
#     sda_ops_local           Fixed read model, BOTH schemas: public (prod) and beta (B2C)
#                             - on prod these are one database, sda_ops, and so they are here.
# Touches nothing but your local server.
set -euo pipefail

IN="${1:-$HOME/Downloads/console-local}"
PGUSER_LOCAL="${PGUSER_LOCAL:-$(whoami)}"
PGHOST_LOCAL="${PGHOST_LOCAL:-127.0.0.1}"
PGPORT_LOCAL="${PGPORT_LOCAL:-5432}"
PSQL=(psql -h "$PGHOST_LOCAL" -p "$PGPORT_LOCAL" -U "$PGUSER_LOCAL" -v ON_ERROR_STOP=1)
say(){ printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

[ -d "$IN" ] || { echo "no snapshot at $IN - run local/pull-from-prod.sh first"; exit 1; }
"${PSQL[@]}" -d postgres -Atc "SELECT 1" >/dev/null \
  || { echo "cannot reach local Postgres at $PGHOST_LOCAL:$PGPORT_LOCAL as $PGUSER_LOCAL"; exit 1; }

ensure_db(){                                  # ensure_db <db>
  local db="$1" a
  if "${PSQL[@]}" -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1; then
    read -r -p "   $db exists - drop and reload? [y/N] " a
    [ "$a" = "y" ] || { echo "   kept as is"; return 1; }
    "${PSQL[@]}" -d postgres -q -c "DROP DATABASE \"$db\";"
  fi
  "${PSQL[@]}" -d postgres -q -c "CREATE DATABASE \"$db\";"
}

load(){                                       # load <snapshot-dir-name> <db>
  local label="$1" db="$2" dir="$IN/$1" sql
  [ -d "$dir" ] || { echo "   ($label not in the snapshot - skipped)"; return 0; }
  sql="$(mktemp /tmp/load-$label.XXXXXX.sql)"
  {
    echo "SET session_replication_role = replica;"   # no FK/trigger ordering worries
    cat "$dir/schema.sql"
    while read -r t; do
      [ -f "$dir/$t.csv" ] || continue
      # schema.sql already created the table in its own schema; search_path below picks it up
      printf '\\copy %s FROM %s CSV HEADER\n' "\"$t\"" "'$dir/$t.csv'"
    done < "$dir/manifest.txt"
  } > "$sql"
  local sch; sch="$(grep -m1 -oE 'CREATE SCHEMA[^;]*' "$dir/schema.sql" | awk '{print $NF}' || true)"
  PGOPTIONS="-c search_path=${sch:-public},public" "${PSQL[@]}" -d "$db" -q -f "$sql" \
    | grep -vE '^(SET|COPY)' || true
  rm -f "$sql"
  "${PSQL[@]}" -d "$db" -q -c "ANALYZE" >/dev/null 2>&1 || true
  printf '   %-22s %-9s %s\n' "$db/${sch:-public}" \
    "$("${PSQL[@]}" -d "$db" -Atc "SELECT pg_size_pretty(pg_database_size('$db'))")" \
    "$("${PSQL[@]}" -d "$db" -Atc "SELECT count(*)||' tables' FROM pg_tables WHERE schemaname='${sch:-public}'")"
}

say "restoring into Postgres at $PGHOST_LOCAL:$PGPORT_LOCAL as $PGUSER_LOCAL"

if ensure_db unified_console_local; then load console "unified_console_local"; fi
if ensure_db salam_source_local;    then load source  "salam_source_local";    fi
if ensure_db sda_ops_local;         then load ops     "sda_ops_local"; load opsbeta "sda_ops_local"; fi

say "what landed"
for db in unified_console_local salam_source_local sda_ops_local; do
  "${PSQL[@]}" -d "$db" -Atc "
    SELECT '   $db  '||schemaname||'.'||relname||'  '||to_char(n_live_tup,'FM999,999,999')
      FROM pg_stat_user_tables WHERE n_live_tup>0 ORDER BY n_live_tup DESC LIMIT 12" 2>/dev/null || true
done

say "DONE - now write local/.env (see local/.env.example) and run  bash local/run-local.sh"
