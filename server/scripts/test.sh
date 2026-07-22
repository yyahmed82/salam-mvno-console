#!/usr/bin/env bash
# CI smoke: syntax-check every server module + client script. Fast, no DB required.
# (Full behavioural tests run against embedded-postgres locally — see README.)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ node --check server modules"
find src -name '*.js' -print0 | while IFS= read -r -d '' f; do
  node --check "$f" && echo "  ok  $f"
done

echo "→ node --check client scripts"
for f in ../*.js; do
  node --check "$f" && echo "  ok  $f"
done

echo "✓ all syntax checks passed"
