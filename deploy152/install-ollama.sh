#!/usr/bin/env bash
# Ollama on server 152 (no internet) — idempotent installer + systemd unit.
#
# Prereqs (hand-carried, already done 2026-08-11):
#   /usr/bin/ollama            — from ollama-linux-amd64.tar.zst (v0.32.7), converted to .tar.gz on
#                                the Mac (152 has no zstd) and extracted with: tar -C /usr -xzf …
#   /root/.ollama/models       — from `ollama pull llama3.1` on the Mac, tarred + extracted here.
#
# NOTE the asset name: since ~v0.3x Ollama ships ollama-linux-amd64.tar.zst (NOT .tgz — that URL
# 404s and curl saves a 9-byte "Not Found" file). v0.32.7 sha256:
#   ed1e39fe8fea90bd7f4c723bd949a2cea3153e111220ec0a183ea5b8dc8b2cae
#
# This script: installs a systemd unit (survives reboots, starts before the console needs it),
# starts it, waits for the API, and warms the model so the first agent chat doesn't hit Yusr's
# 45s timeout on a cold model load.
#
# Usage (as root on 152):  bash install-ollama.sh
set -euo pipefail

BIN=/usr/bin/ollama
MODELS=/root/.ollama/models
HOST=127.0.0.1:11434
MODEL="${OLLAMA_WARM_MODEL:-llama3.1}"

[ -x "$BIN" ] || { echo "✗ $BIN missing — extract ollama-linux-amd64.tar.gz first (see header)"; exit 1; }
[ -d "$MODELS" ] || { echo "✗ $MODELS missing — extract ollama-models.tgz first (see header)"; exit 1; }

echo "▸ installing systemd unit…"
cat > /etc/systemd/system/ollama.service <<EOF
[Unit]
Description=Ollama local LLM server (Yusr backend)
After=network-online.target

[Service]
ExecStart=$BIN serve
User=root
Environment=OLLAMA_HOST=$HOST
Environment=HOME=/root
# keep the model resident so agent chats never pay the ~30s cold-load again
Environment=OLLAMA_KEEP_ALIVE=24h
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# stop any ad-hoc nohup instance so the port is free for the unit
pkill -f "ollama serve" 2>/dev/null && sleep 1 || true

systemctl daemon-reload
systemctl enable --now ollama

echo "▸ waiting for API on $HOST…"
for i in $(seq 1 20); do
  if curl -sf "http://$HOST/api/tags" >/dev/null 2>&1; then break; fi
  sleep 1
  [ "$i" = 20 ] && { echo "✗ API not answering — journalctl -u ollama -n 50"; exit 1; }
done
echo "✓ API up. Models:"
curl -s "http://$HOST/api/tags" | tr ',' '\n' | grep '"name"' || true

echo "▸ warming $MODEL (loads ~5GB into RAM — first time can take a minute)…"
t0=$(date +%s)
curl -s "http://$HOST/api/generate" -d "{\"model\":\"$MODEL\",\"prompt\":\"hi\",\"stream\":false}" >/dev/null || true
echo "✓ warm-up done in $(( $(date +%s) - t0 ))s"

echo
echo "DONE. Verify: systemctl status ollama --no-pager | head -5"
echo "Console: #settings-assist → Test connection → Connected ✓ (URL http://$HOST)"
