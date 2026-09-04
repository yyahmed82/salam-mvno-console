#!/usr/bin/env bash
# REFRESH THE TWO BI CATALOG PDFs THROUGH 31 AUG 2026 — one command from the Mac.
#
#   bash tools/refresh-aug-catalogs.sh
#
# WHY: the August JSON feeds were extracted ON 25 Aug (window said full-month, data stopped at
# the extraction moment). This re-extracts ONLY 2026-08 on 152 (the other 11 months are final),
# copies the three fresh JSONs back, and rebuilds both PDFs locally:
#   Salam-Payment-Errors-Catalog-Sep2025-Aug2026.pdf   (build-bi-pdf.py over bi2/bi)
#   Salam-Journey-Errors-Catalog-Sep2025-Aug2026.pdf   (build-journey-errors-pdf.py over journey-errors)
# Outputs land in the PROJECT ROOT (Salam DMS/) next to the previous versions' names.
set -euo pipefail
cd "$(dirname "$0")/.."                       # mvno-console/
HOST="${DEPLOY_HOST:-yosri@172.31.38.152}"

echo "── 1/3 re-extract August on 152 (replica-only, bounded, ~2-4 min) ──"
# /apps/console is root-owned (PM2 runs as root) — the extractors must run under sudo.
# -t keeps the tty so sudo can ask for your password once.
ssh -t "$HOST" 'sudo bash -lc "
  cd /apps/console/server && set -a; . ../.env; set +a
  node src/biExtract.js        --from 2026-08 --to 2026-08 &&
  node src/biIdentity.js       --from 2026-08 --to 2026-08 &&
  node src/journeyErrExport.js --month 2026-08 --force &&
  cp out/journey-errors/2026-08.json /tmp/journey-2026-08.json &&
  chmod 644 /tmp/bi/2026-08.json /tmp/bi/identity-2026-08.json /tmp/journey-2026-08.json"'

echo "── 2/3 copy the fresh JSONs back ──"
scp "$HOST":/tmp/bi/2026-08.json           bi2/bi/2026-08.json
scp "$HOST":/tmp/bi/identity-2026-08.json  bi2/bi/identity-2026-08.json
scp "$HOST":/tmp/journey-2026-08.json      journey-errors/2026-08.json

echo "── 3/3 rebuild both PDFs ──"
python3 tools/build-bi-pdf.py             bi2/bi          "../Salam-Payment-Errors-Catalog-Sep2025-Aug2026.pdf"
python3 tools/build-journey-errors-pdf.py journey-errors  "../Salam-Journey-Errors-Catalog-Sep2025-Aug2026.pdf"

echo "✓ Done:"
ls -lh ../Salam-Payment-Errors-Catalog-Sep2025-Aug2026.pdf ../Salam-Journey-Errors-Catalog-Sep2025-Aug2026.pdf
python3 - <<'PY'
import json
d=json.load(open('bi2/bi/2026-08.json')); j=json.load(open('journey-errors/2026-08.json'))
print('sanity — payment Aug window:', d.get('window'), '· journey Aug generated:', j.get('generated'))
PY
