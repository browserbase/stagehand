#!/bin/bash
set -e
export ANTHROPIC_API_KEY=${CLAUDE_API_KEY}

create_session() {
  curl -s -X POST https://api.browserbase.com/v1/sessions \
    -H "Content-Type: application/json" \
    -H "X-BB-API-Key: $BROWSERBASE_API_KEY" \
    -d "{\"projectId\": \"$BROWSERBASE_PROJECT_ID\"}" | jq -r '.connectUrl'
}

echo "=== Testing Concurrent Session Isolation ==="
echo ""

# Create two sessions
echo "Creating session A..."
URL_A=$(create_session)
echo "Session A URL: ${URL_A:0:50}..."

echo "Creating session B..."
URL_B=$(create_session)
echo "Session B URL: ${URL_B:0:50}..."

echo ""
echo "--- Starting concurrent navigation ---"

# Navigate both sessions concurrently
./packages/cli/dist/index.js --session session-A --ws "$URL_A" open https://example.com &
PID_A=$!

./packages/cli/dist/index.js --session session-B --ws "$URL_B" open https://github.com &
PID_B=$!

# Wait for both
wait $PID_A
wait $PID_B

echo ""
echo "--- Verifying session isolation ---"

# Check URLs
RESULT_A=$(./packages/cli/dist/index.js --session session-A --ws "$URL_A" get url | jq -r '.url')
RESULT_B=$(./packages/cli/dist/index.js --session session-B --ws "$URL_B" get url | jq -r '.url')

echo "Session A URL: $RESULT_A"
echo "Session B URL: $RESULT_B"

# Verify isolation
if [[ "$RESULT_A" == *"example.com"* ]] && [[ "$RESULT_B" == *"github.com"* ]]; then
  echo ""
  echo "✅ SUCCESS: Sessions are properly isolated!"
  echo "   - session-A is on example.com"
  echo "   - session-B is on github.com"
else
  echo ""
  echo "❌ FAIL: Session contamination detected!"
  exit 1
fi

# Check daemon files
echo ""
echo "--- Daemon files ---"
ls -la /tmp/browse-session-A.* 2>/dev/null | tail -5 || true
ls -la /tmp/browse-session-B.* 2>/dev/null | tail -5 || true

# Check stored CDP URLs
if [ -f "/tmp/browse-session-A.cdp" ]; then
  echo ""
  echo "Session A CDP URL stored: $(cat /tmp/browse-session-A.cdp | cut -c1-60)..."
fi
if [ -f "/tmp/browse-session-B.cdp" ]; then
  echo "Session B CDP URL stored: $(cat /tmp/browse-session-B.cdp | cut -c1-60)..."
fi

echo ""
echo "=== All Tests Passed! ==="
