# _pglocal.sh — sourced by setup-local.sh and restore-local.sh.
# Finds a role that connects to the LOCAL Postgres without prompting, and exports
# PGHOST_LOCAL / PGPORT_LOCAL / PGUSER_LOCAL / PGPASSWORD for everything downstream.
# Default target is the unified-db container (postgres:16) on 127.0.0.1:5700.
PGHOST_LOCAL="${PGHOST_LOCAL:-127.0.0.1}"
PGPORT_LOCAL="${PGPORT_LOCAL:-5700}"
[ -f local/.pglocal.env ] && { set -a; . local/.pglocal.env; set +a; }

_probe(){ PGPASSWORD="$3" PGCONNECT_TIMEOUT=5 psql -w -h "$PGHOST_LOCAL" -p "$PGPORT_LOCAL" -U "$1" -d "$2" -Atc "SELECT version()" 2>&1; }
pglocal_find(){
  local pair cand pw dbc
  PGFOUND=""
  for pair in "${PGUSER_LOCAL:-}|${PGPASSWORD:-}" "$(whoami)|" "postgres|postgres" "postgres|"; do
    cand="${pair%%|*}"; pw="${pair#*|}"
    [ -n "$cand" ] || continue
    for dbc in postgres "$cand"; do
      if PGVER="$(_probe "$cand" "$dbc" "$pw")"; then
        PGFOUND="$cand"; PGUSER_LOCAL="$cand"; PGPASSWORD="$pw"
        export PGHOST_LOCAL PGPORT_LOCAL PGUSER_LOCAL PGPASSWORD
        return 0
      fi
    done
  done
  echo "cannot reach a local PostgreSQL server at $PGHOST_LOCAL:$PGPORT_LOCAL without a password."
  echo "last error: $PGVER"
  echo
  echo "Fix it one of these ways, then re-run:"
  echo "  A) store the credentials once:"
  echo "       printf 'PGUSER_LOCAL=postgres\\nPGPASSWORD=YOURPASSWORD\\n' > local/.pglocal.env && chmod 600 local/.pglocal.env"
  echo "  B) point at a different server:   PGPORT_LOCAL=5432 bash <this script>"
  echo "  C) start the console's dev database:   docker start unified-db"
  return 1
}
