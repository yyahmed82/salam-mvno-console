#!/usr/bin/env bash
# SSH tunnel: laptop → 152 (passerelle) → prod data tier. Keep this running in its own terminal.
#
#   127.0.0.1:15121  → 172.31.15.121:5432   prod PG  (selfcare replica · mvno_console · sda_ops_beta · nexus · payments_v2)
#   127.0.0.1:15434  → 172.31.142.36:5434   UPG / Tap gateway PG (payments)
#   127.0.0.1:13306  → 172.31.43.75:3306    Clara MariaDB via MaxScale (DMS dealers, optional)
#   127.0.0.1:13372  → 172.31.43.72:3306    OSB uil_logs (optional)
#   127.0.0.1:18081  → apigw.salammobile.sa:8081  live UIL/APIGW read (optional; resolved ON 152)
#   127.0.0.1:18080  → fixed BSS (ZSmart transferRest, the base nexus uses) — live Fixed inventory when 152 can route to it
#   127.0.0.1:21434  → 152's own Ollama (Yusr); local Ollama on your Mac already owns 11434 (set OLLAMA_URL=http://127.0.0.1:21434 to use the 152 model)
#
# Add a line per extra endpoint you need to reach "as if you were on 152". Ports are the local side.
set -euo pipefail
HOST="${TUNNEL_HOST:-yosri@172.31.38.152}"
exec ssh -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:15121:172.31.15.121:5432 \
  -L 127.0.0.1:15434:172.31.142.36:5434 \
  -L 127.0.0.1:13306:172.31.43.75:3306 \
  -L 127.0.0.1:13372:172.31.43.72:3306 \
  -L 127.0.0.1:18081:apigw.salammobile.sa:8081 \
  -L 127.0.0.1:21434:127.0.0.1:11434 \
  -L 127.0.0.1:18080:172.20.53.30:8080 \
  "$HOST"
