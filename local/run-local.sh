#!/usr/bin/env bash
# run-local.sh — start the console on http://localhost:3000 against the restored local databases.
#     bash local/run-local.sh            start it
#     bash local/run-local.sh --init     first run: create the console schema + seed the 60 rules
#     bash local/run-local.sh --sync     run one metrics sync (fills snapshots, evaluates alerts)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f local/.env ] || { echo "local/.env missing - copy local/.env.example and set your PG user"; exit 1; }
set -a; . local/.env; set +a
[ -d server/node_modules ] || (cd server && npm install --no-audit --no-fund)

case "${1:-}" in
  --init) node server/src/cli.js init
          node server/src/cli.js admin "${CONSOLE_ADMIN_USER}"
          echo "schema + rules seeded, ${CONSOLE_ADMIN_USER} is super_admin"; exit 0;;
  --sync) node server/src/cli.js sync; exit 0;;
esac

echo "console on http://localhost:${PORT}   (console DB: ${CONSOLE_DATABASE_URL##*/})"
echo "sign in as ${CONSOLE_ADMIN_USER} - with no SMTP the 6-digit code is printed right here"
exec node server/src/api.js
