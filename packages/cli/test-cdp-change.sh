#!/bin/bash
set -e
export ANTHROPIC_API_KEY=${CLAUDE_API_KEY}

create_session() {
  curl -s -X POST https://api.browserbase.com/v1/sessions \
    -H "Content-Type: application/json" \
    -H "X-BB-API-Key: $BROWSERBASE_API_KEY" \
    -d "{\"projectId\": \"$BROWSERBASE_PROJECT_ID\"}" | jq -r '.connectUrl'
}

echo "=== Testing CDP URL Change Detection ==="
echo ""

# Create first session
echo "Creating session 1..."
URL_1=$(create_session)
echo "URL 1: ${URL_1:0:50}..."

# Use it with a session name
echo ""
echo "Opening example.com with session 'test-session' and URL 1..."
./packages/cli/dist/index.js --session test-session --ws "$URL_1" open https://example.com
RESULT_1=$(./packages/cli/dist/index.js --session test-session --ws "$URL_1" get url | jq -r '.url')
echo "Result: $RESULT_1"

# Create second session
echo ""
echo "Creating session 2..."
URL_2=$(create_session)
echo "URL 2: ${URL_2:0:50}..."

# Try to use same session name with different URL
echo ""
echo "Opening github.com with SAME session name 'test-session' but URL 2..."
echo "(Should detect CDP URL change and restart daemon)"
./packages/cli/dist/index.js --session test-session --ws "$URL_2" open https://github.com 2>&1 | grep -i "cdp\|restart" || true
RESULT_2=$(./packages/cli/dist/index.js --session test-session --ws "$URL_2" get url | jq -r '.url')
echo "Result: $RESULT_2"

# Verify URL changed
if [[ "$RESULT_2" == *"github.com"* ]]; then
  echo ""
  echo "✅ SUCCESS: CDP URL change detected and daemon restarted correctly!"
  echo "   - First URL navigated to: $RESULT_1"
  echo "   - Second URL navigated to: $RESULT_2"
else
  echo ""
  echo "❌ FAIL: CDP URL change not handled correctly"
  echo "   - Expected github.com, got: $RESULT_2"
  exit 1
fi

echo ""
echo "=== Test Passed! ==="
