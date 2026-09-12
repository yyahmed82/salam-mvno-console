#!/usr/bin/env bash
# ai-local.sh — make the AI layer work on the Mac, in one step. RUNS ON THE MAC.
#
#     bash local/ai-local.sh              llama3.1 (same model as prod)
#     bash local/ai-local.sh qwen3:8b     any other Ollama tag
#
# WHAT IT FIXES
#   1. Ollama installed, running, and the model pulled.
#   2. The restored PROD setting points Yusr at http://host.docker.internal:11434, which only
#      resolves inside a container. OLLAMA_URL_OVERRIDE wins over that DB value in both
#      llm.js and assist.js, so we set it rather than editing console_settings.
#   3. Both agents, which restore-local.sh deliberately leaves off.
set -euo pipefail
cd "$(dirname "$0")/.."

MODEL="${1:-llama3.1}"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
say(){ printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

say "1/4  Ollama"
if ! command -v ollama >/dev/null; then
  command -v brew >/dev/null || { echo "Homebrew not found - install Ollama from https://ollama.com/download"; exit 1; }
  echo "   installing via Homebrew"
  brew install ollama
fi
ollama --version | sed 's/^/   /'
if ! curl -sS -m 3 "$OLLAMA_URL/api/tags" >/dev/null 2>&1; then
  echo "   starting the server"
  brew services start ollama >/dev/null 2>&1 || { nohup ollama serve >/tmp/ollama-local.log 2>&1 & sleep 3; }
  for i in 1 2 3 4 5 6 7 8 9 10; do curl -sS -m 2 "$OLLAMA_URL/api/tags" >/dev/null 2>&1 && break; sleep 2; done
fi
curl -sS -m 5 "$OLLAMA_URL/api/tags" >/dev/null || { echo "   Ollama is not answering on $OLLAMA_URL"; exit 1; }
echo "   reachable on $OLLAMA_URL"

say "2/4  model $MODEL"
if curl -sS -m 5 "$OLLAMA_URL/api/tags" | grep -q "\"$MODEL\""; then
  echo "   already pulled"
else
  echo "   pulling (a few GB, one time)"
  ollama pull "$MODEL"
fi
curl -sS -m 5 "$OLLAMA_URL/api/tags" \
  | python3 -c "import sys,json;[print('   have:',m['name'],round(m['size']/1e9,1),'GB') for m in json.load(sys.stdin).get('models',[])]"

say "3/4  local/.env"
[ -f local/.env ] || { echo "   local/.env missing - run local/restore-local.sh first"; exit 1; }
mkdir -p local/uploads/tickets local/uploads/docs local/out
python3 - "$OLLAMA_URL" "$MODEL" "$PWD" <<'PY'
import sys
url, model, root = sys.argv[1], sys.argv[2], sys.argv[3]
want = {
  # OVERRIDE beats the restored prod value (host.docker.internal) in llm.js and assist.js
  'OLLAMA_URL_OVERRIDE': url,
  'OLLAMA_MODEL_OVERRIDE': model,
  'OLLAMA_URL': url,
  'OLLAMA_MODEL': model,
  'LLM_PRIMARY_KIND': 'ollama',
  'LLM_PRIMARY_URL': url,
  'LLM_PRIMARY_MODEL': model,
  'LLM_PRIMARY_TIMEOUT_MS': '120000',   # a laptop CPU is slower than 152
  'AGENT_LOG_ENABLED': '1',
  'AGENT_INCIDENT_ENABLED': '1',
  # prod paths - on a laptop they live in the repo
  'UPLOAD_DIR': 'LOCALROOT/local/uploads',
  'OUTDIR': 'LOCALROOT/local/out',
}
want = {k: v.replace('LOCALROOT', root) for k, v in want.items()}
lines = open('local/.env').read().split('\n')
seen, out = set(), []
for line in lines:
    k = line.split('=', 1)[0].strip()
    if k in want: out.append(k + '=' + want[k]); seen.add(k)
    else: out.append(line)
for k, v in want.items():
    if k not in seen: out.append(k + '=' + v)
open('local/.env', 'w').write('\n'.join(out))
PY
grep -E '^(OLLAMA_|LLM_PRIMARY_|AGENT_|UPLOAD_DIR|OUTDIR)' local/.env | sed 's/^/   /'

say "4/4  end-to-end check"
printf '   asking the model through Ollama directly ... '
curl -sS -m 120 "$OLLAMA_URL/api/chat" -H 'content-type: application/json' \
  -d "{\"model\":\"$MODEL\",\"stream\":false,\"messages\":[{\"role\":\"user\",\"content\":\"Reply with the single word: ready\"}]}" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('message',{}).get('content','(no answer)').strip()[:60])"

say "DONE - restart the console so it picks up local/.env"
echo "   Ctrl-C the running server, then:   bash local/run-local.sh"
echo "   then check  http://localhost:3000/#agents  - PRIMARY should read $OLLAMA_URL"
