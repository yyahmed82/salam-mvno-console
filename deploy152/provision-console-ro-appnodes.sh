#!/usr/bin/env bash
# PROVISION console_ro ON THE FOUR DMS APP NODES (mvno-appdigp01–04) — Phase 1 of the
# APIGW/DMS logs plan. Mirrors the api_logger pattern on 43.17/.18: key-only login for the
# console's existing /root/.ssh/api_log_ed25519 identity, read-only purpose (log greps).
#
# THIS FILE IS THE RUNBOOK OF RECORD — the same commands are pasted into the PAM root
# sessions, because the nodes are not reachable for file transfer from this repo.
#
# ── STEP A · on 152 (as yosri) ─ print the public key + test the traffic-IP ports ──
#   sudo cat /root/.ssh/api_log_ed25519.pub
#   for ip in 172.31.43.136 172.31.43.137 172.31.43.138 172.31.43.139; do
#     timeout 3 bash -c "echo > /dev/tcp/$ip/22" 2>/dev/null && echo "$ip:22 OPEN" || echo "$ip:22 closed"
#   done
#
# ── STEP B · on EACH node (PAM, root) ─ create the user; PUBKEY = output of step A ──
#   PUBKEY='ssh-ed25519 AAAA... root@ruh-salam-site03'
#   id console_ro 2>/dev/null || useradd -m -s /bin/bash console_ro
#   passwd -l console_ro                                  # key-only, no password ever
#   install -d -m 700 -o console_ro -g console_ro /home/console_ro/.ssh
#   echo "no-port-forwarding,no-agent-forwarding,no-X11-forwarding $PUBKEY" \
#     > /home/console_ro/.ssh/authorized_keys
#   chown console_ro:console_ro /home/console_ro/.ssh/authorized_keys
#   chmod 600 /home/console_ro/.ssh/authorized_keys
#   # sshd allow-list check — do NOT edit blindly; only if AllowUsers/AllowGroups exists:
#   grep -E '^\s*Allow(Users|Groups)' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/* 2>/dev/null \
#     && echo '>> ADD console_ro to the Allow list above, then: systemctl reload sshd' \
#     || echo 'no Allow list — nothing to change'
#   # read-access check on the logs (as console_ro):
#   su -s /bin/bash console_ro -c 'ls /opt/application/*/logs >/dev/null 2>&1 && head -c 200 $(ls /opt/application/unified-integration-layer*/logs/*.log 2>/dev/null | head -1) >/dev/null 2>&1 && echo LOGS-READABLE || echo LOGS-NOT-READABLE'
#   # ONLY IF "LOGS-NOT-READABLE" — grant read via ACL (files stay owned untouched):
#   #   for d in /opt/application/*/logs; do setfacl -m u:console_ro:rx "$d"; setfacl -d -m u:console_ro:r "$d"; done
#   #   find /opt/application/*/logs -maxdepth 1 -type f -exec setfacl -m u:console_ro:r {} +
#
# ── STEP C · from 152 (as yosri) ─ verify each node end-to-end ──
#   for ip in 172.31.43.136 172.31.43.137 172.31.43.138 172.31.43.139; do
#     echo "== $ip =="
#     sudo ssh -i /root/.ssh/api_log_ed25519 -o BatchMode=yes -o ConnectTimeout=5 \
#       -o StrictHostKeyChecking=accept-new console_ro@$ip \
#       'hostname; ls /opt/application 2>/dev/null | wc -l; ls /opt/application/unified-integration-layer*/logs/*.log 2>/dev/null | head -2'
#   done
#   # expected per node: hostname · "18" (service dirs) · two current UIL log paths.
#
# Security posture: the key grants a locked, no-forwarding, non-sudo account whose only value
# is reading logs the console will mask before display. Nothing on the nodes is modified beyond
# the user (and ACLs only if the perms check demands them).
echo "This is a runbook — read the comments; the commands are pasted into PAM sessions."
