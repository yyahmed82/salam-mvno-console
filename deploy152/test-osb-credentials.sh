#!/usr/bin/env bash
# Test a credential against the OSB log host (172.31.43.72) — SSH and/or MySQL.
#
#   bash test-osb-credentials.sh                 # defaults to 172.31.43.72
#   bash test-osb-credentials.sh 172.31.43.72 yosri.a
#
# The password is TYPED AT THE PROMPT, never passed as an argument and never written to a file that
# outlives the run — so it stays out of shell history, out of `ps`, and out of any log. A temporary
# my.cnf (mode 0600) is used because `mysql -pPASSWORD` is visible to every user on the box via ps.
set -uo pipefail

HOST="${1:-172.31.43.72}"
USER_ID="${2:-yosri.a}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
DB="${OSB_DB_NAME:-logs}"
TABLE="${OSB_LOG_TABLE:-uil_logs}"

say()  { printf '\n\033[1m%s\033[0m\n%s\n' "$1" "$(printf '─%.0s' $(seq ${#1}))"; }
ok()   { printf '  \033[32mOK  \033[0m %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; }
warn() { printf '  \033[33mNOTE\033[0m %s\n' "$1"; }

TMP=""; cleanup() { [ -n "$TMP" ] && shred -u "$TMP" 2>/dev/null || rm -f "$TMP"; }; trap cleanup EXIT

say "0 · reachability"
for p in 22 "$MYSQL_PORT"; do
  if timeout 5 bash -c "echo > /dev/tcp/$HOST/$p" 2>/dev/null; then ok "$HOST:$p reachable"
  else bad "$HOST:$p NOT reachable (firewall/route — no point testing credentials on this port)"; fi
done

printf '\nPassword for %s@%s (input hidden, then press Enter): ' "$USER_ID" "$HOST"
IFS= read -rs PW; echo
[ -z "$PW" ] && { bad "no password entered"; exit 2; }

# ---- what the password will need in a URL -------------------------------------------------
say "1 · URL safety of this password"
ENC=$(printf '%s' "$PW" | sed -e 's/%/%25/g' -e 's/@/%40/g' -e 's/:/%3A/g' -e 's|/|%2F|g' \
                              -e 's/#/%23/g' -e 's/?/%3F/g' -e 's/\[/%5B/g' -e 's/\]/%5D/g')
if [ "$ENC" = "$PW" ]; then
  ok "safe to use verbatim in a connection URL"
else
  warn "contains characters that BREAK a connection URL — it must be percent-encoded."
  warn "  raw     : ${PW//?/•}  (${#PW} chars)"
  warn "  encoded : ${ENC//[^%A-Za-z0-9]/•}  ← use this form inside OSB_LOG_URL"
  warn "  '#' truncates a URL at the fragment; '@' splits user from host. Both fail SILENTLY."
  warn "  Safer still: ask for a password with letters and digits only."
fi

# ---- SSH ----------------------------------------------------------------------------------
say "2 · SSH login"
if ! command -v sshpass >/dev/null 2>&1; then
  warn "sshpass not installed — test SSH by hand:   ssh ${USER_ID}@${HOST}"
else
  if SSHPASS="$PW" sshpass -e ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 \
       -o PreferredAuthentications=password -o PubkeyAuthentication=no \
       "${USER_ID}@${HOST}" 'echo connected; id; hostname' 2>/dev/null; then
    ok "SSH accepted these credentials"
  else
    bad "SSH rejected them (or password auth is disabled on this host)"
  fi
fi

# ---- MySQL --------------------------------------------------------------------------------
say "3 · MySQL login + read access to ${DB}.${TABLE}"
if ! command -v mysql >/dev/null 2>&1; then
  warn "mysql client not installed. Install:  sudo dnf install -y mysql   (or mariadb)"
  warn "Then re-run. Skipping the MySQL half."
  exit 0
fi

TMP="$(mktemp)"; chmod 600 "$TMP"
printf '[client]\nuser=%s\npassword="%s"\nhost=%s\nport=%s\n' "$USER_ID" "$PW" "$HOST" "$MYSQL_PORT" > "$TMP"

if OUT=$(mysql --defaults-file="$TMP" -N -B -e 'SELECT 1' 2>&1); then
  ok "MySQL accepted these credentials"

  if OUT=$(mysql --defaults-file="$TMP" -N -B -e "SELECT count(*) FROM \`$DB\`.\`$TABLE\`" 2>&1); then
    ok "can read ${DB}.${TABLE} — $OUT rows total"

    echo
    echo "  columns (confirm these match the OSB_LOG_*_COL env names):"
    mysql --defaults-file="$TMP" -e \
      "SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema='$DB' AND table_name='$TABLE' ORDER BY ordinal_position" 2>/dev/null \
      | sed 's/^/    /'

    echo
    echo "  1500 / OSB-382000 faults in the last 24h (the read-path faults we cannot see today):"
    mysql --defaults-file="$TMP" -e \
      "SELECT date_format(insert_date_time,'%Y-%m-%d %H:00') AS hour, count(*) AS faults
         FROM \`$DB\`.\`$TABLE\`
        WHERE (response_code='1500' OR response_message LIKE '%OSB-382000%')
          AND insert_date_time >= now() - interval 24 hour
        GROUP BY 1 ORDER BY 1" 2>&1 | sed 's/^/    /'
  else
    bad "logged in, but cannot read ${DB}.${TABLE}"
    echo "    $OUT" | head -3
    warn "Needs:  GRANT SELECT ON ${DB}.${TABLE} TO '${USER_ID}'@'<this-host>';"
  fi
else
  bad "MySQL rejected them"
  echo "    $OUT" | head -3
  case "$OUT" in
    *"Access denied"*) warn "The server answered — so the NETWORK is fine and only the grant is missing." ;;
    *"Can't connect"*) warn "Could not reach the MySQL port at all — that is a firewall/route problem." ;;
  esac
fi

say "next"
echo "  If MySQL worked, add to /apps/console/.env  (note the ENCODED password):"
echo "    OSB_LOG_URL=mysql://${USER_ID}:<encoded-password>@${HOST}:${MYSQL_PORT}/${DB}"
echo "  Then:  pm2 restart console  &&  node /apps/console/server/postdeploy-check.cjs"
echo "  Section 6 should turn from NOTE (not configured) into PASS (reachable)."
echo
echo "  This password has been typed in a terminal and shared in chat — rotate it once testing is done."
