#!/usr/bin/env bash
# Run the unified console locally against prod data (through the 152 tunnel) + local console DB.
#   1) bash tools/local/tunnel-152.sh          (terminal A, keep open)
#   2) docker compose -f docker-compose.unified.yml up -d
#   3) bash tools/local/env-from-152.sh        (once; writes .env.local)
#   4) bash tools/local/dev.sh                 (terminal B)  → http://localhost:4700/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
[ -f .env.local ] || { echo "✗ .env.local missing — run tools/local/env-from-152.sh first"; exit 1; }
set -a; . ./.env.local; set +a
export STATIC_DIR="$ROOT"
mkdir -p "${UPLOAD_DIR:-$ROOT/.local-uploads}"
# tunnel + local db reachable?
(exec 3<>/dev/tcp/127.0.0.1/15121) 2>/dev/null || { echo "✗ tunnel not up on 127.0.0.1:15121 — start tools/local/tunnel-152.sh"; exit 1; }
(exec 3<>/dev/tcp/127.0.0.1/5700)  2>/dev/null || { echo "✗ local postgres not up on 127.0.0.1:5700 — docker compose -f docker-compose.unified.yml up -d"; exit 1; }
[ -d server/node_modules ] || (cd server && npm install --omit=dev --no-audit --no-fund)
for f in server/src/*.js *.js; do node --check "$f" >/dev/null; done
echo "▸ unified console → http://localhost:4700/   (OTP codes print in this terminal when SMTP is unset)"
cd server && exec node src/boot.js
