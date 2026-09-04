#!/usr/bin/env bash
# Install the prod-sync watchdog as a cron job on 152.  Run once, as root:
#   bash /apps/console/install-watchdog.sh
set -euo pipefail

APP=/apps/console
CRON_FILE=/etc/cron.d/salam-console-sync
NODE="$(command -v node || echo /usr/bin/node)"

[ -f "$APP/server/sync-watchdog.cjs" ] || { echo "✗ $APP/server/sync-watchdog.cjs missing (deploy first)"; exit 1; }
mkdir -p "$APP/logs"

# Every 5 minutes. `set -a; . .env` exports the DB URLs; TZ is pinned inside the script too.
cat > "$CRON_FILE" <<EOF
# Salam Digital Console — prod-sync watchdog (measures first, syncs only when behind)
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
*/5 * * * * root cd $APP/server && set -a && . $APP/.env && set +a && $NODE $APP/server/sync-watchdog.cjs >> $APP/logs/sync-watchdog.log 2>&1
EOF
chmod 0644 "$CRON_FILE"

# logrotate so the log can't fill the disk
cat > /etc/logrotate.d/salam-console <<'EOF'
/apps/console/logs/*.log {
    daily
    rotate 14
    compress
    missingok
    notifempty
    copytruncate
}
EOF

systemctl reload crond 2>/dev/null || systemctl restart crond 2>/dev/null || true
echo "✓ installed $CRON_FILE (every 5 min)"
echo "✓ logrotate: /etc/logrotate.d/salam-console (14 days)"
echo
echo "test it now:"
echo "  cd $APP && set -a && . .env && set +a && node server/sync-watchdog.cjs; echo \"exit=\$?\""
echo "watch:"
echo "  tail -f $APP/logs/sync-watchdog.log"
