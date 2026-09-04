#!/usr/bin/env bash
# DMS APP-BACKEND LOG RECON — mvno-appdigp01 (172.31.42.25) — 31 Aug 2026
# STRICTLY READ-ONLY: ls / find / du / tail / ps / systemctl status only. Touches no service,
# writes ONLY /tmp/dms-log-recon.txt. Run as root, then review the file before sharing
# (tail samples may contain customer data — the console side will mask, but the paste is manual).
#
# GOAL: learn where each DMS microservice logs, in what format, how big, how it rotates —
# the facts needed to design the read-only log collector (same pattern as the API-host one).
exec > /tmp/dms-log-recon.txt 2>&1
echo "=== $(hostname) · $(date -Is) ==="
echo; echo "--- network identity (which traffic IP is this node) ---"
ip -br addr | grep -v "lo "
echo; echo "--- how the services run (java/node/pm2/systemd) ---"
ps -eo user,pid,etime,rss,cmd --sort=-rss | grep -Ei "dms|trms|integration" | grep -v grep | cut -c1-220
echo
systemctl list-units --type=service --no-pager 2>/dev/null | grep -Ei "dms|trms|uil|integration" || echo "(no systemd units matched)"
echo; echo "--- per-service tree: where are the logs ---"
for d in /opt/application/*/; do
  s=$(basename "$d")
  echo "== $s"
  find "$d" -maxdepth 3 -type d \( -iname "*log*" -o -iname "logs" \) 2>/dev/null | sed 's/^/   dir: /'
  # newest 3 log-like files anywhere under the service (bounded depth)
  find "$d" -maxdepth 4 -type f \( -iname "*.log" -o -iname "*.out" -o -iname "*.log.*" -o -iname "*.gz" \) \
    -printf "%T@ %s %p\n" 2>/dev/null | sort -rn | head -3 | awk '{printf "   file: %s  %.1fMB  %s\n", strftime("%Y-%m-%d %H:%M",$1), $2/1048576, $3}'
done
echo; echo "--- total log volume per service ---"
for d in /opt/application/*/; do
  v=$(find "$d" -maxdepth 4 -type f \( -iname "*.log*" -o -iname "*.out" \) -exec du -cb {} + 2>/dev/null | tail -1 | cut -f1)
  printf "%-45s %8.1f MB\n" "$(basename "$d")" "$(echo "${v:-0}/1048576" | bc -l)"
done
echo; echo "--- FORMAT SAMPLES: last 3 lines of the newest log per service (review before sharing) ---"
for d in /opt/application/*/; do
  f=$(find "$d" -maxdepth 4 -type f \( -iname "*.log" -o -iname "*.out" \) -printf "%T@ %p\n" 2>/dev/null | sort -rn | head -1 | cut -d" " -f2-)
  [ -n "$f" ] && { echo "== $(basename "$d") → $f"; tail -3 "$f" | cut -c1-400; echo; }
done
echo; echo "--- rotation config ---"
ls -la /etc/logrotate.d/ 2>/dev/null | grep -Ei "dms|trms|app|uil" || echo "(no matching logrotate entries)"
echo; echo "--- other backend nodes (are 02/03/04 the same layout) ---"
getent hosts mvno-appdigp02 mvno-appdigp03 mvno-appdigp04 2>/dev/null || echo "(names not resolvable from here)"
echo; echo "--- can THIS node reach the console (for push option) / can 152 pull (SSH inbound)? ---"
timeout 3 bash -c "echo > /dev/tcp/172.31.38.152/4600" 2>/dev/null && echo "→ 172.31.38.152:4600 reachable (push possible)" || echo "→ 172.31.38.152:4600 NOT reachable"
ss -tlnp 2>/dev/null | grep ":22 " >/dev/null && echo "→ sshd listening (pull possible if firewall allows 152 → this host :22)"
echo; echo "=== recon complete → /tmp/dms-log-recon.txt ==="
