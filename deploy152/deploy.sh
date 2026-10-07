#!/usr/bin/env bash
# One-command deploy of the Digital Console to server 152.
#
#   bash mvno-console/deploy152/deploy.sh              # deploy changed files + restart + verify
#   bash mvno-console/deploy152/deploy.sh --web-only   # frontend only → NO restart (instant)
#   bash mvno-console/deploy152/deploy.sh --full        # include node_modules (after dep changes)
#   bash mvno-console/deploy152/deploy.sh --no-restart  # push files, restart later yourself
#
# Routes each file to the right place automatically (server/src, server/db, web/) — no manual cp.
# One SSH connection → one password prompt (zero with an SSH key: ssh-copy-id yosri@172.31.38.152).
set -euo pipefail

HOST="${DEPLOY_HOST:-yosri@172.31.38.152}"
# Deployment target on 152 (unified console is the default for this repo):
#   DEPLOY_TARGET=unified  → /apps/unified  · PM2 salam-unified · :4701  (4700 is taken by salam-undertaking on 152) · https://salam.sa/unified-console/
#   DEPLOY_TARGET=digital  → /apps/console  · PM2 salam-console · :4600 · https://salam.sa/digital-console/  (frozen line)
TARGET="${DEPLOY_TARGET:-unified}"
case "$TARGET" in
  unified) APP="/apps/unified"; PM2NAME="salam-unified"; PORT="${UNIFIED_PORT:-4701}"; URL="https://salam.sa/unified-console/";;
  digital) APP="/apps/console"; PM2NAME="salam-console"; PORT=4600; URL="https://salam.sa/digital-console/";;
  *) echo "✗ unknown DEPLOY_TARGET=$TARGET (unified|digital)"; exit 1;;
esac
ROOT="$(cd "$(dirname "$0")/.." && pwd)"   # → mvno-console/, wherever you invoke this from
MODE="${1:-}"

cd "$ROOT"

# ---- 1. syntax-check everything locally FIRST (never ship a file that can't parse) ----
echo "▸ checking syntax…"
for f in server/src/*.js server/scripts/*.cjs *.js; do [ -e "$f" ] || continue; node --check "$f" >/dev/null || { echo "✗ SYNTAX ERROR in $f — aborting"; exit 1; }; done
echo "  ✓ all JS parses"

# ---- 2. build the payload ----
STAGE="$(mktemp -d /tmp/csync.XXXX)"
mkdir -p "$STAGE/server/src" "$STAGE/server/db" "$STAGE/server/scripts" "$STAGE/web"
cp server/src/*.js            "$STAGE/server/src/"
cp deploy152/ecosystem.prod.config.js "$STAGE/ecosystem.prod.config.js"   # unified: PORT/name come from .env
cp server/db/*.sql            "$STAGE/server/db/"
cp server/scripts/*.cjs       "$STAGE/server/scripts/" 2>/dev/null || true   # one-off jobs (converge-import…)
cp deploy152/healthcheck.cjs  "$STAGE/server/healthcheck.cjs" 2>/dev/null || true   # lives beside node_modules
cp deploy152/postdeploy-check.cjs "$STAGE/server/postdeploy-check.cjs" 2>/dev/null || true  # needs pg + src/
cp deploy152/find-osb-log-table.cjs "$STAGE/server/find-osb-log-table.cjs" 2>/dev/null || true
cp deploy152/sql.cjs           "$STAGE/server/sql.cjs" 2>/dev/null || true   # csql read-only query tool
cp deploy152/perfmail.cjs      "$STAGE/server/perfmail.cjs" 2>/dev/null || true   # performance report by mail (cron 12:00 on 152)
cp deploy152/purge-user-secrets.cjs "$STAGE/server/purge-user-secrets.cjs" 2>/dev/null || true  # one-shot replica credential purge
cp deploy152/dms-discover.cjs  "$STAGE/server/dms-discover.cjs" 2>/dev/null || true      # DMS data-tier discovery (read-only)
cp deploy152/dms-business-discover.cjs "$STAGE/server/dms-business-discover.cjs" 2>/dev/null || true  # dealer-domain + dms_audit_logs census (read-only)
cp deploy152/apigw-log-discover.sh "$STAGE/server/apigw-log-discover.sh" 2>/dev/null || true  # APIGW node log census (run ON 42.25-28 via PAM)
cp deploy152/verify-flex-cutover.cjs "$STAGE/server/verify-flex-cutover.cjs" 2>/dev/null || true      # Flex grandfather-block verification (read-only)
cp deploy152/find-activation-ledger.cjs "$STAGE/server/find-activation-ledger.cjs" 2>/dev/null || true # locate the real activation/commission ledger (read-only)
cp deploy152/dealer-check.cjs  "$STAGE/server/dealer-check.cjs" 2>/dev/null || true      # Dealer 360 CLI (in-process, no HTTP session needed)
cp deploy152/test-smtp.cjs "$STAGE/server/test-smtp.cjs" 2>/dev/null || true                  # needs nodemailer
cp deploy152/sync-watchdog.cjs "$STAGE/server/sync-watchdog.cjs" 2>/dev/null || true # needs pg → beside node_modules
cp deploy152/check-fixed-sources.cjs "$STAGE/server/check-fixed-sources.cjs" 2>/dev/null || true  # Fixed › Errors read-model census (read-only, needs pg + src/)
cp deploy152/test-budget-mails.cjs "$STAGE/server/test-budget-mails.cjs" 2>/dev/null || true   # send the real AI-budget mails to one address for review (writes nothing)
cp deploy152/install-watchdog.sh "$STAGE/install-watchdog.sh" 2>/dev/null || true
cp deploy152/install-ollama.sh "$STAGE/install-ollama.sh" 2>/dev/null || true
cp deploy152/jar-release-diff.sh "$STAGE/server/jar-release-diff.sh" 2>/dev/null || true   # DMS release diff (class-level, CFR) — bash /apps/unified/server/jar-release-diff.sh
mkdir -p "$STAGE/server/tools"; cp deploy152/tools/cfr.jar "$STAGE/server/tools/cfr.jar" 2>/dev/null || true   # CFR 0.152 decompiler (2 MB), used by jar-release-diff.sh   # Ollama systemd unit with the memory ceiling (run once on 152: bash /apps/unified/install-ollama.sh)
cp server/package.json        "$STAGE/server/"
[ -d server/jdbc ] && { mkdir -p "$STAGE/server/jdbc"; cp server/jdbc/*.java "$STAGE/server/jdbc/" 2>/dev/null || true; }   # Arqami JDBC bridge source (compiled on 152)
# build stamp → /api/version reports the milestone actually shipped (VERSION file + git commit/tag)
printf '{ "version": "%s", "commit": "%s", "tag": "%s", "builtAt": "%s" }\n' \
  "$(cat VERSION 2>/dev/null | tr -d '[:space:]')" "$(git rev-parse --short HEAD 2>/dev/null || echo dev)" \
  "$(git describe --tags --exact-match 2>/dev/null || git describe --tags 2>/dev/null || echo '')" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STAGE/server/build.json"
cp ./*.js ./*.html ./*.css     "$STAGE/web/" 2>/dev/null || true
# docs artifacts: imported API references (otoDocs/salamApiDocs .json for the viewers) and the
# .md runbooks/KB files that assist.js reads from STATIC_DIR (OPS_RUNBOOK, OTO_API_DOCS, …)
cp ./*.json ./*.md            "$STAGE/web/" 2>/dev/null || true
rm -f "$STAGE/web/ecosystem.prod.config.js"
[ -d assets ] && cp -R assets "$STAGE/web/"
[ -d fixed-diagrams ] && cp -R fixed-diagrams "$STAGE/web/"   # Fixed › Diagrams iframe pages (+ mermaid.min.js)
if [ "$MODE" = "--full" ]; then
  echo "▸ including node_modules (full mode)…"
  ( cd server && npm install --omit=dev --no-audit --no-fund --silent )
  cp -R server/node_modules "$STAGE/server/"
fi
COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -czf /tmp/console-sync.tgz -C "$STAGE" . 2>/dev/null \
  || tar czf /tmp/console-sync.tgz -C "$STAGE" .   # (flags are macOS-specific; fall back if unsupported)
rm -rf "$STAGE"
echo "▸ payload: $(du -h /tmp/console-sync.tgz | cut -f1)"

# ---- 3. ship + apply + restart + verify, in ONE ssh session ----
RESTART=1
[ "$MODE" = "--no-restart" ] && RESTART=0
[ "$MODE" = "--web-only" ] && RESTART=0

echo "▸ uploading…"
# upload into the login user's HOME (…/console-sync.tgz), not shared /tmp:
# a root-owned leftover in /tmp would make scp fail with "Permission denied".
RUSER="${HOST%@*}"; [ "$RUSER" = "$HOST" ] && RUSER="$(whoami)"
scp -q /tmp/console-sync.tgz "$HOST":console-sync.tgz
SRC="/home/$RUSER/console-sync.tgz"

ssh -t "$HOST" "sudo bash -s -- $RESTART ${MODE:-none} $SRC $APP $PM2NAME $PORT" <<'REMOTE'
set -euo pipefail
RESTART="$1"; MODE="$2"; SRC="$3"; APP="$4"; PM2NAME="$5"; PORT="$6"
# sudo strips PATH → pm2 (in /usr/local/bin) would be "command not found" and the restart
# would silently no-op, leaving the OLD code running. Resolve it explicitly.
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
PM2="$(command -v pm2 || echo /usr/local/bin/pm2)"
[ -x "$PM2" ] || { echo "✗ pm2 not found (looked in /usr/local/bin) — aborting"; exit 1; }
[ -s "$SRC" ] || { echo "✗ payload missing/empty at $SRC"; exit 1; }
rm -rf /tmp/csync && mkdir -p /tmp/csync && tar xzf "$SRC" -C /tmp/csync
mkdir -p "$APP/server/src" "$APP/server/db" "$APP/server/scripts" "$APP/web"   # first deploy of a new target: create the tree

if [ "$MODE" = "--web-only" ]; then
  cp -f /tmp/csync/web/* "$APP/web/" 2>/dev/null || true
  # the sub-folders are NOT covered by web/* — without these two lines a --web-only deploy silently
  # shipped a stale fixed-diagrams/ (the Fixed atlas kept its old build for a whole day, 11 Sep 2026)
  [ -d /tmp/csync/web/assets ] && cp -R /tmp/csync/web/assets "$APP/web/"
  [ -d /tmp/csync/web/fixed-diagrams ] && cp -R /tmp/csync/web/fixed-diagrams "$APP/web/"
  echo "▸ web files updated incl. assets/ + fixed-diagrams/ (hard-refresh the browser; no restart needed)"
else
  cp -f /tmp/csync/server/src/*.js  "$APP/server/src/"
  cp -f /tmp/csync/server/db/*.sql  "$APP/server/db/"
  cp -f /tmp/csync/server/scripts/*.cjs "$APP/server/scripts/" 2>/dev/null || true
  cp -f /tmp/csync/server/package.json "$APP/server/" 2>/dev/null || true
  cp -f /tmp/csync/server/build.json "$APP/server/" 2>/dev/null || true
  if [ -d /tmp/csync/server/jdbc ]; then mkdir -p "$APP/server/jdbc"; cp -f /tmp/csync/server/jdbc/*.java "$APP/server/jdbc/" 2>/dev/null || true
    JAVAC="${JAVAC:-/opt/java/bin/javac}"; OJDBC="$(ls "$APP"/server/jdbc/ojdbc*.jar 2>/dev/null | head -1)"
    if [ -x "$JAVAC" ] && [ -n "$OJDBC" ]; then (cd "$APP/server/jdbc" && "$JAVAC" -encoding UTF-8 -cp "$OJDBC" ArqamiBridge.java && echo "▸ ArqamiBridge compiled (JDBC bridge for EBPROD 9i)") || echo "✗ ArqamiBridge failed to compile"; else echo "▸ JDBC bridge not compiled (javac=$JAVAC ojdbc=${OJDBC:-missing}) — Arqami stays on oracledb/CSV"; fi
    MSSQLJAR="$(ls "$APP"/server/jdbc/mssql-jdbc*.jar 2>/dev/null | head -1)"
    if [ -x "$JAVAC" ] && [ -f "$APP/server/jdbc/RemedyBridge.java" ]; then (cd "$APP/server/jdbc" && "$JAVAC" -encoding UTF-8 RemedyBridge.java && echo "▸ RemedyBridge compiled (JDBC bridge for Remedy ARSystem)${MSSQLJAR:+ · driver $(basename "$MSSQLJAR")}") || echo "✗ RemedyBridge failed to compile"; fi
    [ -n "$MSSQLJAR" ] || echo "▸ no mssql-jdbc*.jar in $APP/server/jdbc — CST Escalations stays on the runbook snapshot until it is copied there once"
  fi
  [ -d /tmp/csync/server/node_modules ] && { rm -rf "$APP/server/node_modules"; cp -R /tmp/csync/server/node_modules "$APP/server/"; echo "▸ node_modules replaced"; }
  cp -f /tmp/csync/web/* "$APP/web/" 2>/dev/null || true
  [ -f /tmp/csync/ecosystem.prod.config.js ] && cp -f /tmp/csync/ecosystem.prod.config.js "$APP/ecosystem.prod.config.js"
  [ -d /tmp/csync/web/assets ] && cp -R /tmp/csync/web/assets "$APP/web/"
  [ -d /tmp/csync/web/fixed-diagrams ] && cp -R /tmp/csync/web/fixed-diagrams "$APP/web/"
  cp -f /tmp/csync/server/healthcheck.cjs "$APP/server/" 2>/dev/null || true
  cp -f /tmp/csync/server/postdeploy-check.cjs "$APP/server/" 2>/dev/null || true
  cp -f /tmp/csync/server/find-osb-log-table.cjs "$APP/server/" 2>/dev/null || true
  cp -f /tmp/csync/server/test-smtp.cjs "$APP/server/" 2>/dev/null || true
  cp -f /tmp/csync/server/sync-watchdog.cjs "$APP/server/" 2>/dev/null || true
  cp -f /tmp/csync/server/sql.cjs "$APP/server/" 2>/dev/null || true          # csql (read-only query tool)
  cp -f /tmp/csync/server/check-fixed-sources.cjs "$APP/server/" 2>/dev/null || true   # Fixed › Errors read-model census
  cp -f /tmp/csync/server/test-budget-mails.cjs "$APP/server/" 2>/dev/null || true   # AI-budget mail preview
  cp -f /tmp/csync/server/purge-user-secrets.cjs "$APP/server/" 2>/dev/null || true
  cp -f /tmp/csync/server/dms-discover.cjs "$APP/server/" 2>/dev/null || true
  cp -f /tmp/csync/server/dms-business-discover.cjs "$APP/server/" 2>/dev/null || true
  cp -f /tmp/csync/server/apigw-log-discover.sh "$APP/server/" 2>/dev/null || true
  cp -f /tmp/csync/server/verify-flex-cutover.cjs "$APP/server/" 2>/dev/null || true
  cp -f /tmp/csync/server/find-activation-ledger.cjs "$APP/server/" 2>/dev/null || true
  cp -f /tmp/csync/server/dealer-check.cjs "$APP/server/" 2>/dev/null || true
  cp -f /tmp/csync/install-watchdog.sh "$APP/" 2>/dev/null || true
  cp -f /tmp/csync/install-ollama.sh "$APP/" 2>/dev/null || true
  cp -f /tmp/csync/server/jar-release-diff.sh "$APP/server/" 2>/dev/null || true
  mkdir -p "$APP/server/tools"; cp -f /tmp/csync/server/tools/cfr.jar "$APP/server/tools/" 2>/dev/null || true
  rm -f "$APP/healthcheck.cjs" 2>/dev/null || true   # remove the old misplaced copy
  echo "▸ server + web files updated"
fi
rm -rf /tmp/csync "$SRC"

if [ "$RESTART" = "1" ]; then
  echo "▸ restarting (delete+start so .env is re-read)…"
  cd "$APP"
  OLDPID="$($PM2 pid "$PM2NAME" 2>/dev/null | tr -d '[:space:]' || true)"
  $PM2 delete "$PM2NAME" >/dev/null 2>&1 || true
  # AI agents (10 Sep 2026): separate PM2 apps in the same ecosystem file — delete them too so they pick up new code
  AGENT_BASE="${PM2NAME%-unified}"
  $PM2 delete "$AGENT_BASE-agent-log" >/dev/null 2>&1 || true
  $PM2 delete "$AGENT_BASE-agent-incident" >/dev/null 2>&1 || true
  $PM2 start ecosystem.prod.config.js >/dev/null && $PM2 save >/dev/null
  NEWPID="$($PM2 pid "$PM2NAME" 2>/dev/null | tr -d '[:space:]' || true)"
  echo "▸ pid ${OLDPID:-none} → ${NEWPID:-?}"
  [ -n "$NEWPID" ] && [ "$NEWPID" != "$OLDPID" ] || { echo "✗ process did NOT restart"; exit 1; }
  # wait for the port to answer (boot does schema init + index checks first)
  printf "▸ waiting for :$PORT "
  for i in $(seq 1 90); do
    code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/ || true)
    [ "$code" = "200" ] && { echo " ✓ UP (${i}s)"; break; }
    printf "."; sleep 2
  done
  [ "${code:-000}" = "200" ] || { echo " ✗ still not up — last 20 log lines:"; $PM2 logs "$PM2NAME" --err --lines 20 --nostream; exit 1; }
  echo "▸ boot summary:"
  grep -E "console init|source indexes|API on|PROD-SYNC|OSB fault|APIGW connectivity" "$APP/logs/console.out.log" | tail -6
fi
REMOTE

echo
echo "✅ deployed to $HOST ($TARGET → $APP, pm2 $PM2NAME, :$PORT)"
[ "$MODE" = "--web-only" ] && echo "   → hard-refresh $URL" || echo "   → $URL"
