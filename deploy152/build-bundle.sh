#!/usr/bin/env bash
# Build the Salam Digital Console bundle for server 152 (no internet on the box → everything pre-packed).
# Run ON YOUR MAC from the repo:   bash mvno-console/deploy152/build-bundle.sh
# Output: /tmp/console152.tgz  →  scp to 152 and follow deploy152/DEPLOY.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"          # mvno-console/
STAGE="$(mktemp -d /tmp/console152.XXXX)"
echo "staging in $STAGE"

# 1) server: sources + production node_modules (all deps are pure JS — safe to build on macOS for RHEL)
mkdir -p "$STAGE/server"
cp -R "$ROOT/server/src" "$ROOT/server/db" "$ROOT/server/package.json" "$STAGE/server/"
( cd "$STAGE/server" && npm install --omit=dev --no-audit --no-fund --silent )
# guard: fail the build if any native binding sneaked in (would break RHEL/FIPS)
if find "$STAGE/server/node_modules" -name '*.node' | grep -q .; then
  echo "ERROR: native .node bindings found — bundle would not be portable"; exit 1
fi

# 2) web static (served via STATIC_DIR): the console UI files
mkdir -p "$STAGE/web"
cp "$ROOT"/index.html "$ROOT"/*.js "$ROOT"/*.html "$STAGE/web/" 2>/dev/null || true
rm -f "$STAGE/web/ecosystem.prod.config.js" 2>/dev/null || true
[ -d "$ROOT/assets" ] && cp -R "$ROOT/assets" "$STAGE/web/"

# 3) runtime config
cp "$ROOT/deploy152/ecosystem.prod.config.js" "$STAGE/"
cp "$ROOT/deploy152/env.template" "$STAGE/env.template"
cp "$ROOT/deploy152/DEPLOY.md" "$STAGE/"

# 4) pack
tar czf /tmp/console152.tgz -C "$STAGE" .
rm -rf "$STAGE"
echo "OK → /tmp/console152.tgz  ($(du -h /tmp/console152.tgz | cut -f1))"
echo "next: scp /tmp/console152.tgz yosri@172.31.38.152:/tmp/   then follow DEPLOY.md"
