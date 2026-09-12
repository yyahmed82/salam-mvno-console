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

say "0/3  connection strings"
if [ -s "$CRED" ]; then
  echo "   already have $CRED"
else
  echo "   reading /apps/unified/.env on 152 (one sudo prompt, a read only)"
  ssh "$SSH_HOST" 'sudo cat /apps/unified/.env' \
    | grep -E '^(CONSOLE|SOURCE|OPS|OPS_BETA)_DATABASE_URL=' > "$CRED"
  chmod 600 "$CRED"
fi
sed -E 's#://[^@]*@*[^@/]*@#://****@#' "$CRED" | sed 's/^/   /'  

say "1/3  PostgreSQL client on this Mac"
if ! command -v psql >/dev/null || ! command -v pg_dump >/dev/null; then
  echo "   installing libpq via Homebrew"
  brew install libpq && brew link --force libpq
fi
psql --version | sed 's/^/   /'

. local/_pglocal.sh
pglocal_find || exit 1
echo "   server: ${PGVER%% (*}"
echo "   role:   $PGUSER_LOCAL   on $PGHOST_LOCAL:$PGPORT_LOCAL"

say "2/3  pull $DAYS days from prod (read-only, through the SSH tunnel)"
bash local/pull-from-prod.sh "$DAYS" "$OUT"

say "3/3  restore into the Mac's Postgres"
bash local/restore-local.sh "$OUT"

if [ "$RUN" = "--run" ]; then
  say "starting the console"
  exec bash local/run-local.sh
fi
say "READY - start it with:   bash local/run-local.sh"
