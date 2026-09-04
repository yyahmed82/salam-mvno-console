#!/usr/bin/env bash
# Build .env.local for the unified console from the two PROD env files on 152, rewriting every DB host
# to the tunnel and DROPPING everything that must never run from a laptop (prod-sync writer, SSH log
# collectors, probes, ChatOps webhooks, SMS). Read-only credentials only.
#
#   bash tools/local/env-from-152.sh        # writes ./.env.local (chmod 600) — review it, then tools/local/dev.sh
#
# Sources on 152 (read with sudo, never copied whole):
#   /apps/console/.env            → SOURCE_DATABASE_URL (selfcare replica), UPG_DATABASE_URL, DMS_DB_URL, OSB_LOG_URL, SMTP_*
#   /apps/salam-ops-beta/.env     → DATABASE_URL (sda_ops_beta) → OPS_DATABASE_URL, SOURCE_DATABASE_URL (nexus) → NEXUS_DATABASE_URL,
#                                   PAYMENTS_DATABASE_URL, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY → GMAPS_KEY
set -euo pipefail
HOST="${TUNNEL_HOST:-yosri@172.31.38.152}"
OUT="${1:-.env.local}"
BETA_ENV="${BETA_ENV:-/apps/salam-ops-beta/.env}"     # fall back to /apps/salam-ops/.env if the beta dir is absent

echo "▸ reading prod env keys from $HOST (sudo) …"
RAW="$(ssh -t "$HOST" "sudo bash -c '
  echo \"### console\"; grep -E \"^(SOURCE_DATABASE_URL|UPG_DATABASE_URL|DMS_DB_URL|DMS_DB_HOST|DMS_DB_USER|DMS_DB_PASSWORD|OSB_LOG_URL|SMTP_HOST|SMTP_PORT|SMTP_FROM|SMTP_TLS_REJECT_UNAUTHORIZED|SMTP_IGNORE_TLS|CONSOLE_SUPER_ADMINS|ROOT_ADMINS|CONSOLE_ADMIN_USER)=\" /apps/console/.env || true
  echo \"### beta\";    f=$BETA_ENV; [ -f \$f ] || f=/apps/salam-ops/.env; grep -E \"^(DATABASE_URL|SOURCE_DATABASE_URL|PAYMENTS_DATABASE_URL|NEXT_PUBLIC_GOOGLE_MAPS_API_KEY|STATIC_MAPS_KEY)=\" \$f || true
'" | tr -d '\r')"

get() { # get <section> <KEY>
  printf '%s\n' "$RAW" | awk -v sec="### $1" -v key="$2" '
    $0==sec {on=1; next} /^### / {on=0} on && index($0, key"=")==1 {sub(key"=",""); print; exit}' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}
tunnel() { # rewrite prod hosts → local tunnel ports
  printf '%s' "$1" | sed -e 's#172\.31\.15\.121:5432#127.0.0.1:15121#g' -e 's#172\.31\.43\.75:3306#127.0.0.1:13306#g' -e 's#172\.31\.43\.72:3306#127.0.0.1:13372#g'
}

SRC="$(tunnel "$(get console SOURCE_DATABASE_URL)")"
UPG="$(tunnel "$(get console UPG_DATABASE_URL)")"
DMS="$(tunnel "$(get console DMS_DB_URL)")"
OSB="$(tunnel "$(get console OSB_LOG_URL)")"
OPS="$(tunnel "$(get beta DATABASE_URL)")"
NEXUS="$(tunnel "$(get beta SOURCE_DATABASE_URL)")"
PAY="$(tunnel "$(get beta PAYMENTS_DATABASE_URL)")"
GMAPS="$(get beta NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)"
SMAPS="$(get beta STATIC_MAPS_KEY)"

[ -n "$SRC" ] || { echo "✗ SOURCE_DATABASE_URL not found in /apps/console/.env"; exit 1; }
[ -n "$OPS" ] || echo "⚠ DATABASE_URL (sda_ops_beta) not found — Fixed side will report 'not configured'"

umask 077
cat > "$OUT" <<ENV
# ---- unified console · LOCAL DEV · generated $(date -u +%FT%TZ) by tools/local/env-from-152.sh ----
# Read side = PROD data through the SSH tunnel (tools/local/tunnel-152.sh). Write side = local docker DB.
PORT=4700
TZ=UTC
STATIC_DIR=..
NODE_ENV=development
FIXED_ENABLED=1
PM2_NAME=salam-unified-local
CONSOLE_PUBLIC_URL=http://localhost:4700/

# console's OWN db (writable) — local docker (docker-compose.unified.yml)
CONSOLE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5700/unified_console
# MVNO read side (selfcare replica on 121, kept fresh by the PROD console's prod-sync — do NOT sync from here)
SOURCE_DATABASE_URL=$SRC
PROD_DATABASE_URL=
SOURCE_POOL_MAX=4
# Fixed / Salam Home read side (stage 1: the dealer-ops read model, still written by opsb-ingest-watch on 152)
OPS_DATABASE_URL=$OPS
NEXUS_DATABASE_URL=$NEXUS
PAYMENTS_DATABASE_URL=$PAY
# optional MVNO pools
UPG_DATABASE_URL=$UPG
DMS_DB_URL=$DMS
OSB_LOG_URL=$OSB
# maps (Phase 2)
GMAPS_KEY=$GMAPS
STATIC_MAPS_KEY=$SMAPS

# auth — OTP is printed to the server log when SMTP is unset (dev), so leave SMTP_* empty locally
CONSOLE_SUPER_ADMINS=$(get console CONSOLE_SUPER_ADMINS)
ROOT_ADMINS=$(get console ROOT_ADMINS)
CONSOLE_ADMIN_USER=$(get console CONSOLE_ADMIN_USER)
UPLOAD_DIR=$PWD/.local-uploads
# SSH-based samplers/collectors are 152-only (need its keys + firewall rules) — off locally
UILS_SAMPLE=0
UILS_WATCH=0
OSB_PROBE_AUTO=0
DMS_JOURNEY_SYNC=0

# DELIBERATELY UNSET locally (prod-only side effects): API_LOG_HOSTS, ZIPKIN_HOSTS, SN_URL, SMS_URL,
# chatops webhooks, SEMATI_PROBE_*, OSB_PROBE_AUTO, PROD_DATABASE_URL, IPRL_REDIS_URL
ENV
echo "✓ wrote $OUT"
grep -E "^(SOURCE|OPS|NEXUS|PAYMENTS|UPG|DMS_DB|OSB_LOG)_" "$OUT" | sed -E 's#(://[^:]+:)[^@]+@#\1***@#'
