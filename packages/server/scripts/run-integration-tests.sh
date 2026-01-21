#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f ../../.env ]; then
  set -a
  # shellcheck disable=SC1091
  source ../../.env
  set +a
fi

PORT="${PORT:-3107}"
export STAGEHAND_API_URL="${STAGEHAND_API_URL:-http://127.0.0.1:${PORT}}"
export NODE_ENV="${NODE_ENV:-development}"
export BB_ENV="${BB_ENV:-local}"
export PORT

node --import tsx src/server.ts &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "Waiting for server at ${STAGEHAND_API_URL}..."
for i in {1..30}; do
  if curl -s --max-time 2 "${STAGEHAND_API_URL}/healthz" > /dev/null 2>&1; then
    echo "Server is ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Server failed to start within 30 seconds."
    exit 1
  fi
  sleep 1
done

pnpm run node:test $(find ./test/integration/v3 -type f -name '*.test.ts')
