#!/usr/bin/env bash
# setup-local.sh — one command, from nothing to the console on http://localhost:3000. RUNS ON THE MAC.
#
#     bash local/setup-local.sh              30 days of history
#     bash local/setup-local.sh 7            7 days (fast first run)
#     bash local/setup-local.sh 30 --run     pull, restore, configure AND start the server
#
# Steps: credentials off 152 -> client check -> pull through the SSH tunnel -> restore -> local/.env
set -euo pipefail
cd "$(dirname "$0")/.."

DAYS="${1:-30}"
RUN="${2:-}"
OUT="${OUT:-$HOME/Downloads/console-local}"
SSH_HOST="${SSH_HOST:-yosri@ruh-salam-site03}"
CRED="${CRED:-$HOME/.salam-prod-db.env}"
say(){ printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

say "0/4  connection strings"
if [ -s "$CRED" ]; then
  echo "   already have $CRED"
else
  echo "   reading /apps/unified/.env on 152 (one sudo prompt, a read only)"
  ssh "$SSH_HOST" 'sudo cat /apps/unified/.env' \
    | grep -E '^(CONSOLE|SOURCE|OPS|OPS_BETA)_DATABASE_URL=' > "$CRED"
  chmod 600 "$CRED"
fi
sed -E 's#://[^@]*@*[^@/]*@#://****@#' "$CRED" | sed 's/^/   /'  

say "1/4  PostgreSQL client on this Mac"
if ! command -v psql >/dev/null || ! command -v pg_dump >/dev/null; then
  echo "   installing libpq via Homebrew"
  brew install libpq && brew link --force libpq
fi
psql --version | sed 's/^/   /'

PGHOST_LOCAL="${PGHOST_LOCAL:-127.0.0.1}"
PGPORT_LOCAL="${PGPORT_LOCAL:-5432}"
[ -f local/.pglocal.env ] && { set -a; . local/.pglocal.env; set +a; }   # optional: PGUSER_LOCAL / PGPASSWORD

probe(){ PGCONNECT_TIMEOUT=5 psql -w -h "$PGHOST_LOCAL" -p "$PGPORT_LOCAL" -U "$1" -d "$2" -Atc "SELECT version()" 2>&1; }
FOUND=""
for cand in ${PGUSER_LOCAL:-} "$(whoami)" postgres; do
  [ -n "$cand" ] || continue
  for dbc in postgres "$cand"; do
    if OUTV="$(probe "$cand" "$dbc")"; then FOUND="$cand"; FOUNDDB="$dbc"; break 2; fi
  done
done

if [ -n "$FOUND" ]; then
  echo "   server: ${OUTV%% (*}"
  echo "   role:   $FOUND   (via $FOUNDDB)"
  PGUSER_LOCAL="$FOUND"
else
  echo "   a server IS listening on $PGHOST_LOCAL:$PGPORT_LOCAL but no role connects without a password."
  echo "   last error: $OUTV"
  echo
  echo "   Pick ONE of these, then re-run this script:"
  echo "     A) you know the password - store it once:"
  echo "          printf '%s\n' \"$PGHOST_LOCAL:$PGPORT_LOCAL:*:$(whoami):YOURPASSWORD\" >> ~/.pgpass && chmod 600 ~/.pgpass"
  echo "        or put PGUSER_LOCAL=... and PGPASSWORD=... in local/.pglocal.env"
  echo "     B) trust local connections (a laptop, so this is fine):"
  echo "          psql -h $PGHOST_LOCAL -U postgres -d postgres -Atc \"SHOW hba_file\""
  echo "          then set the 127.0.0.1/::1 lines to 'trust' and: brew services restart postgresql@16"
  echo "     C) start fresh with a Homebrew server that trusts you:"
  echo "          brew install postgresql@16 && brew services start postgresql@16"
  echo "          export PATH=\"/opt/homebrew/opt/postgresql@16/bin:\$PATH\" && createdb \"$(whoami)\""
  exit 1
fi
export PGHOST_LOCAL PGPORT_LOCAL PGUSER_LOCAL

say "2/4  pull $DAYS days from prod (read-only, through the SSH tunnel)"
bash local/pull-from-prod.sh "$DAYS" "$OUT"

say "3/4  restore into the Mac's Postgres"
bash local/restore-local.sh "$OUT"

say "4/4  local/.env"
if [ -f local/.env ]; then
  echo "   local/.env already exists - left untouched"
else
  cp local/.env.example local/.env
  sed -i '' "s/CHANGEME/$(whoami)/g" local/.env
  echo "   written with PGUSER=$(whoami)"
fi
grep -E '^(PORT|CONSOLE_DATABASE_URL|SOURCE_DATABASE_URL|OPS)' local/.env | sed 's/^/   /'

if [ "$RUN" = "--run" ]; then
  say "starting the console"
  exec bash local/run-local.sh
fi
say "READY - start it with:   bash local/run-local.sh"
