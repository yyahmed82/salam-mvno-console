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
# MEMORY (27 Sep 2026): 152 is shared with production apps and has 15.4 GB. Ollama was still a bare `nohup ollama serve`
# (this unit was never active) and its runner (llama-server) reached 12.6 GB RSS: 0.5 GB available, 2 GB in swap, a CRIT
# healthcheck mail all day. The unit pins what the console needs (one slot, one model, the console's 8k context) AND puts
# a cgroup ceiling on the whole Ollama tree: MemoryHigh=8G / MemoryMax=9G — the kernel reclaims Ollama first at 8 GB and
# can kill ONLY the Ollama cgroup at 9 GB; the console's agents log the failed call and retry; production apps are never
# the victim. Expected footprint: weights ≈ 4.9 GB + KV (1 slot × 8192 ctx) ≈ 1 GB + buffers ≈ 6–7 GB.
# Overridable per run: OLLAMA_PARALLEL=2 OLLAMA_MEM_HIGH=9G OLLAMA_MEM_MAX=10G bash install-ollama.sh
#
# Usage (as root on 152):  bash install-ollama.sh
set -euo pipefail

BIN=/usr/bin/ollama
MODELS=/root/.ollama/models
HOST=127.0.0.1:11434
MODEL="${OLLAMA_WARM_MODEL:-llama3.1}"
CTX="${OLLAMA_WARM_CTX:-8192}"                 # the context the console uses (llm.js num_ctx 8192) — the unit's default AND the warm-up,
                                                # so the first real call never makes Ollama reload the model with another context
PARALLEL="${OLLAMA_PARALLEL:-1}"
MEM_HIGH="${OLLAMA_MEM_HIGH:-8G}"
MEM_MAX="${OLLAMA_MEM_MAX:-9G}"

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
# the console asks keep_alive 30m on every call; 24h here only kept a model resident through a silent night
Environment=OLLAMA_KEEP_ALIVE=30m
# 26 Sep 2026: llama-server grew to 12.2 GB RSS (model 5.2 GB) and pushed 152 to 96 % RAM + 2 GB swap. Default
# parallel slots multiply the 8k KV cache; one slot is enough for 3 callers on CPU (they queue), one model at a time.
Environment=OLLAMA_NUM_PARALLEL=$PARALLEL
Environment=OLLAMA_MAX_LOADED_MODELS=1
Environment=OLLAMA_CONTEXT_LENGTH=$CTX
Environment=OLLAMA_MAX_QUEUE=64
# memory ceiling for the whole Ollama tree (server + runner) — this box is shared with production
MemoryAccounting=yes
MemoryHigh=$MEM_HIGH
MemoryMax=$MEM_MAX
OOMPolicy=continue
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# stop any ad-hoc nohup instance (and its runner) so the port is free for the unit; a running unit is restarted with the new settings
systemctl stop ollama 2>/dev/null || true
pkill -f "ollama serve" 2>/dev/null && sleep 1 || true
pkill -f "ollama/llama-server|ollama runner|ollama_llama_server" 2>/dev/null && sleep 1 || true

systemctl daemon-reload
systemctl enable ollama >/dev/null 2>&1 || true
systemctl restart ollama

echo "▸ waiting for API on $HOST…"
for i in $(seq 1 20); do
  if curl -sf "http://$HOST/api/tags" >/dev/null 2>&1; then break; fi
  sleep 1
  [ "$i" = 20 ] && { echo "✗ API not answering — journalctl -u ollama -n 50"; exit 1; }
done
echo "✓ API up. Models:"
curl -s "http://$HOST/api/tags" | tr ',' '\n' | grep '"name"' || true

echo "▸ warming $MODEL at num_ctx $CTX (loads ~5GB into RAM — first time can take a minute)…"
t0=$(date +%s)
curl -s "http://$HOST/api/generate" -d "{\"model\":\"$MODEL\",\"prompt\":\"hi\",\"stream\":false,\"keep_alive\":\"30m\",\"options\":{\"num_ctx\":$CTX,\"num_predict\":4}}" >/dev/null || true
echo "✓ warm-up done in $(( $(date +%s) - t0 ))s"

echo
echo "▸ unit limits:"; systemctl show ollama -p MemoryHigh -p MemoryMax -p MemoryCurrent --no-pager 2>/dev/null || true
echo "▸ Ollama tree RSS now:"; ps -eo rss=,comm= --sort=-rss | awk '/ollama|llama/ {printf "  %s %.1f GB\n", $2, $1/1048576}' || true
echo "▸ box:"; free -m | sed -n '1,2p'
echo
echo "DONE. Verify: systemctl status ollama --no-pager | head -5"
echo "Console: #settings-assist → Test connection → Connected ✓ (URL http://$HOST)"
