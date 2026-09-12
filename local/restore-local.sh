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
cd "$(dirname "$0")/.."
. local/_pglocal.sh
pglocal_find || exit 1
PSQL=(psql -h "$PGHOST_LOCAL" -p "$PGPORT_LOCAL" -U "$PGUSER_LOCAL" -v ON_ERROR_STOP=1)
say(){ printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

[ -d "$IN" ] || { echo "no snapshot at $IN - run local/pull-from-prod.sh first"; exit 1; }

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
  local label="$1" db="$2" dir="$IN/$1"
  [ -d "$dir" ] || { echo "   ($label not in the snapshot - skipped)"; return 0; }
  local sch; sch="$(grep -m1 -oE 'CREATE SCHEMA[^;]*' "$dir/schema.sql" | awk '{print $NF}' || true)"
  sch="${sch:-public}"
  local ddl="/tmp/restore-$label-ddl.log" dat="/tmp/restore-$label-data.log"
  : > "$ddl"

  # --- pass 0: extensions. pg_dump -n <schema> does NOT dump extensions (they belong to the
  # database, not the schema), so gen_random_uuid() (pgcrypto) and gin_trgm_ops (pg_trgm) were
  # missing and every CREATE TABLE using them failed - taking their indexes and FKs with them.
  # Prefer the exact list captured from prod; otherwise create the usual suspects, tolerantly.
  if [ -f "$dir/extensions.sql" ]; then
    "${PSQL[@]}" -d "$db" -q -f "$dir/extensions.sql" >> "$ddl" 2>&1 || true
  else
    for e in pgcrypto pg_trgm citext hstore unaccent uuid-ossp btree_gin btree_gist intarray ltree tablefunc; do
      psql -h "$PGHOST_LOCAL" -p "$PGPORT_LOCAL" -U "$PGUSER_LOCAL" -d "$db" -q \
        -c "CREATE EXTENSION IF NOT EXISTS \"$e\"" >/dev/null 2>&1 || true
    done
  fi
  printf '   %-9s EXT  %s\n' "$label" \
    "$("${PSQL[@]}" -d "$db" -Atc "SELECT string_agg(extname,' ' ORDER BY extname) FROM pg_extension")"

  # --- pass 1: DDL. NOT ON_ERROR_STOP - a full-schema dump legitimately trips on things the
  # local server already has (schema public, an extension it cannot install). What matters is
  # whether the tables exist afterwards, which pass 3 checks.
  sed -E 's/^CREATE SCHEMA ([^;]+);/CREATE SCHEMA IF NOT EXISTS \1;/' "$dir/schema.sql" \
    | psql -h "$PGHOST_LOCAL" -p "$PGPORT_LOCAL" -U "$PGUSER_LOCAL" -d "$db" -q > "$ddl" 2>&1 || true
  local ddlerr; ddlerr=$(grep -ci '^psql.*ERROR' "$ddl" || true)
  printf '   %-9s DDL  %s tables created%s\n' "$label" \
    "$("${PSQL[@]}" -d "$db" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname='$sch'")" \
    "$([ "$ddlerr" -gt 0 ] && echo "  ($ddlerr non-fatal notices - $ddl)")"

  # --- pass 2: data, one \copy per table, in one session. session_replication_role=replica so
  # FK order cannot matter. Failures are collected, not fatal, so one bad table cannot hide the rest.
  local sql; sql="$(mktemp /tmp/load-$label.XXXXXX.sql)"
  {
    echo "SET session_replication_role = replica;"
    while read -r t; do
      [ -f "$dir/$t.csv" ] || continue
      printf '\\echo LOADING %s\n' "$t"
      printf '\\copy "%s" FROM %s CSV HEADER\n' "$t" "'$dir/$t.csv'"
    done < "$dir/manifest.txt"
  } > "$sql"
  PGOPTIONS="-c search_path=$sch,public" psql -h "$PGHOST_LOCAL" -p "$PGPORT_LOCAL" \
       -U "$PGUSER_LOCAL" -d "$db" -q -f "$sql" > "$dat" 2>&1 || true
  rm -f "$sql"
  # \copy keeps the original ids but leaves every sequence at 1 - the next INSERT would collide
  # ("duplicate key value violates unique constraint login_otps_pkey" at sign-in). Move them past max(id).
  "${PSQL[@]}" -d "$db" -q -f local/fix-sequences.sql >/dev/null 2>&1 || true
  "${PSQL[@]}" -d "$db" -q -c "ANALYZE" >/dev/null 2>&1 || true

  # --- pass 3: verify every table we have a CSV for actually has its rows
  local bad=0 t rows want
  while read -r t; do
    [ -f "$dir/$t.csv" ] || continue
    want=$(( $(wc -l < "$dir/$t.csv") - 1 )); [ "$want" -lt 0 ] && want=0
    rows=$("${PSQL[@]}" -d "$db" -Atc "SELECT count(*) FROM \"$sch\".\"$t\"" 2>/dev/null || echo MISSING)
    # a CSV line count is only an upper bound - a quoted JSON value may contain a newline - so a
    # real failure is "the table is not there" or "nothing loaded", not a small count difference.
    if [ "$rows" = "MISSING" ] || { [ "$want" -gt 0 ] && [ "$rows" -eq 0 ]; }; then
      bad=$((bad+1)); printf '     !! %-32s csv ~%-9s loaded %s\n' "$t" "$want" "$rows"
    elif [ "$rows" != "$want" ]; then
      printf '     .  %-32s csv ~%-9s loaded %s (multi-line values)\n' "$t" "$want" "$rows"
    fi
  done < "$dir/manifest.txt"

  if [ "$bad" -gt 0 ]; then
    echo "   !! $label: $bad table(s) did not load - first errors:"
    grep -iE '^(psql:|ERROR|FATAL)' "$dat" | head -6 | sed 's/^/      /'
    echo "      data log: $dat   ddl log: $ddl"
    return 1
  fi
  printf '   %-9s DATA ok  %s  %s\n' "$label" \
    "$("${PSQL[@]}" -d "$db" -Atc "SELECT pg_size_pretty(pg_database_size('$db'))")" \
    "$(wc -l < "$dir/manifest.txt" | tr -d ' ') tables verified"
  return 0
}

say "restoring into Postgres at $PGHOST_LOCAL:$PGPORT_LOCAL as $PGUSER_LOCAL"

FAILED=0
if ensure_db unified_console_local; then load console "unified_console_local" || FAILED=1; fi
if ensure_db salam_source_local;    then load source  "salam_source_local"    || FAILED=1; fi
if ensure_db sda_ops_local;         then load ops     "sda_ops_local" || FAILED=1; load opsbeta "sda_ops_local" || FAILED=1; fi

say "what landed"
for db in unified_console_local salam_source_local sda_ops_local; do
  "${PSQL[@]}" -d "$db" -Atc "
    SELECT '   $db  '||schemaname||'.'||relname||'  '||to_char(n_live_tup,'FM999,999,999')
      FROM pg_stat_user_tables WHERE n_live_tup>0 ORDER BY n_live_tup DESC LIMIT 12" 2>/dev/null || true
done

say "local/.env"
AUTH="$PGUSER_LOCAL"
[ -n "${PGPASSWORD:-}" ] && AUTH="$PGUSER_LOCAL:$PGPASSWORD"
[ -f local/.env ] || cp local/.env.example local/.env
python3 - "postgres://$AUTH@$PGHOST_LOCAL:$PGPORT_LOCAL" <<'PY'
import sys
base = sys.argv[1]
urls = {
  'CONSOLE_DATABASE_URL':  base + '/unified_console_local',
  'SOURCE_DATABASE_URL':   base + '/salam_source_local',
  'OPS_DATABASE_URL':      base + '/sda_ops_local?schema=public',
  'OPS_BETA_DATABASE_URL': base + '/sda_ops_local?schema=beta',
}
# hard OFF locally - a laptop must never mail a real person or reach prod
urls.update({
  'SMTP_HOST': '', 'SMTP_USER': '', 'SMTP_PASS': '', 'SMTP_FROM': '',
  'HEALTHCHECK_INTERVAL_MIN': '0', 'PROD_DATABASE_URL': '',
  'AGENT_LOG_ENABLED': '0', 'AGENT_INCIDENT_ENABLED': '0',
  'SN_URL': '', 'API_LOG_HOSTS': '', 'ZIPKIN_HOSTS': '', 'OSB_LOG_URL': '', 'UPG_DATABASE_URL': '',
})
lines = open('local/.env').read().split('\n')
seen, out = set(), []
for line in lines:
    k = line.split('=', 1)[0].strip()
    if k in urls: out.append(k + '=' + urls[k]); seen.add(k)
    else: out.append(line)
for k, v in urls.items():
    if k not in seen: out.append(k + '=' + v)
open('local/.env', 'w').write('\n'.join(out))
PY
sed -E 's#://[^@]*@#://****@#' local/.env | grep -E '^(PORT|CONSOLE_DATABASE_URL|SOURCE_DATABASE_URL|OPS)' | sed 's/^/   /'
echo "   mail: OFF (SMTP_HOST empty - notify.js and otp.js gate every send on it)"
grep -c '^SMTP_HOST=$' local/.env >/dev/null && true

if [ "$FAILED" = "1" ]; then
  say "FINISHED WITH ERRORS - see the logs above. The console will not start cleanly."
  exit 1
fi
say "DONE - start it with:   bash local/run-local.sh"
