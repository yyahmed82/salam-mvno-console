#!/usr/bin/env bash
# restore-local.sh — load the snapshot into the Postgres ON YOUR MAC and print the env to use.
# RUN ON THE MAC:
#     bash local/restore-local.sh ~/Downloads/console-local
#
# Creates (replacing, with a prompt, if they exist):
#     unified_console_local   the console's own DB - your rules, users, incidents, settings
#     salam_source_local      the scoped copy of the source replica
#     sda_ops_local           Fixed read model        (only if ops.dump is in the snapshot)
#     sda_ops_beta_local      Fixed B2C read model    (only if opsbeta.dump is in the snapshot)
# Reads the .dump files and writes only to your local server - it never touches prod.
set -euo pipefail

IN="${1:-$HOME/Downloads/console-local}"
PGUSER_LOCAL="${PGUSER_LOCAL:-$(whoami)}"
PGHOST_LOCAL="${PGHOST_LOCAL:-127.0.0.1}"
PGPORT_LOCAL="${PGPORT_LOCAL:-5432}"
PSQL="psql -h $PGHOST_LOCAL -p $PGPORT_LOCAL -U $PGUSER_LOCAL"
say(){ printf '\n== %s ==\n' "$*"; }

[ -d "$IN" ] || { echo "no snapshot directory at $IN"; exit 1; }
$PSQL -d postgres -Atc "SELECT 1" >/dev/null || { echo "cannot reach local Postgres at $PGHOST_LOCAL:$PGPORT_LOCAL as $PGUSER_LOCAL"; exit 1; }

load() {                       # load <dumpfile> <dbname> [rename]
  local f="$IN/$1" db="$2" rename="${3:-}" a
  [ -f "$f" ] || { echo "     ($1 not in the snapshot - skipped)"; return 0; }
  if $PSQL -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1; then
    read -r -p "     $db exists - drop and reload? [y/N] " a
    [ "$a" = "y" ] || { echo "     kept as is"; return 0; }
    $PSQL -d postgres -q -c "DROP DATABASE \"$db\";"
  fi
  $PSQL -d postgres -q -c "CREATE DATABASE \"$db\";"
  pg_restore -h "$PGHOST_LOCAL" -p "$PGPORT_LOCAL" -U "$PGUSER_LOCAL" -d "$db" --no-owner --no-privileges "$f" 2>&1 | grep -v "^pg_restore: warning" || true
  if [ -n "$rename" ]; then     # source/ops dumps arrive in schema local_snap -> make it public
    $PSQL -d "$db" -q -c "DROP SCHEMA IF EXISTS public CASCADE; ALTER SCHEMA local_snap RENAME TO public;"
  fi
  printf '     %-24s %-8s %s tables\n' "$db" "$($PSQL -d "$db" -Atc "SELECT pg_size_pretty(pg_database_size('$db'))")" "$($PSQL -d "$db" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
}

say "restoring into Postgres at $PGHOST_LOCAL:$PGPORT_LOCAL as $PGUSER_LOCAL"
load console.dump  unified_console_local
load source.dump   salam_source_local   rename
load ops.dump      sda_ops_local        rename
load opsbeta.dump  sda_ops_beta_local   rename

say "row counts actually loaded"
$PSQL -d salam_source_local -Atc "
  SELECT '     '||relname||'  '||to_char(n_live_tup,'FM999,999,999')
    FROM pg_stat_user_tables WHERE schemaname='public' AND n_live_tup>0 ORDER BY n_live_tup DESC" 2>/dev/null || true

say "DONE - local/.env should contain"
cat <<ENVV
PORT=3000
TZ=UTC
CONSOLE_DATABASE_URL=postgres://$PGUSER_LOCAL@$PGHOST_LOCAL:$PGPORT_LOCAL/unified_console_local
SOURCE_DATABASE_URL=postgres://$PGUSER_LOCAL@$PGHOST_LOCAL:$PGPORT_LOCAL/salam_source_local
OPS_DATABASE_URL=postgres://$PGUSER_LOCAL@$PGHOST_LOCAL:$PGPORT_LOCAL/sda_ops_local
OPS_BETA_DATABASE_URL=postgres://$PGUSER_LOCAL@$PGHOST_LOCAL:$PGPORT_LOCAL/sda_ops_beta_local
ENVV
