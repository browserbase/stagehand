#!/bin/bash
# Test script to verify session isolation for concurrent stagehand commands

set -e

echo "=== Testing stagehand-cli Session Isolation ==="
echo ""

# Check if we have required env vars
if [ -z "$BROWSERBASE_API_KEY" ] || [ -z "$BROWSERBASE_PROJECT_ID" ]; then
  echo "ERROR: BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID must be set"
  exit 1
fi

# Create a function to create a Browserbase session
create_session() {
  local session_name=$1
  echo "[${session_name}] Creating Browserbase session..."

  local response=$(curl -s -X POST https://api.browserbase.com/v1/sessions \
    -H "Content-Type: application/json" \
    -H "X-BB-API-Key: $BROWSERBASE_API_KEY" \
    -d "{
      \"projectId\": \"$BROWSERBASE_PROJECT_ID\"
    }")

  local session_id=$(echo "$response" | jq -r '.id')
  local connect_url=$(echo "$response" | jq -r '.connectUrl')

  if [ "$session_id" == "null" ] || [ -z "$session_id" ]; then
    echo "[${session_name}] ERROR: Failed to create session"
    echo "$response"
    exit 1
  fi

  echo "[${session_name}] Session created: $session_id"
  echo "$connect_url"
}

# Test 1: Single session
echo "--- Test 1: Single Session ---"
URL_A=$(create_session "test-A")
echo "[test-A] Connect URL: $URL_A"
echo ""

# Use the CLI with explicit session and ws URL
echo "[test-A] Running: stagehand --session test-A --ws \$URL_A open https://example.com"
./packages/cli/dist/index.js --session test-A --ws "$URL_A" open https://example.com

echo "[test-A] Running: stagehand --session test-A --ws \$URL_A get url"
RESULT_A=$(./packages/cli/dist/index.js --session test-A --ws "$URL_A" get url)
echo "[test-A] Current URL: $RESULT_A"

if [ "$RESULT_A" == "https://example.com/" ]; then
  echo "[test-A] ✅ SUCCESS: Navigated to correct URL"
else
  echo "[test-A] ❌ FAIL: Expected https://example.com/, got $RESULT_A"
  exit 1
fi

echo ""
echo "--- Test 2: Concurrent Sessions ---"

# Create two sessions
URL_B=$(create_session "test-B")
echo "[test-B] Connect URL: $URL_B"
echo ""

# Test concurrent execution (simulate what happens in eval framework)
echo "[test-A] Opening example.com in background..."
./packages/cli/dist/index.js --session test-A --ws "$URL_A" open https://example.com &
PID_A=$!

echo "[test-B] Opening github.com in background..."
./packages/cli/dist/index.js --session test-B --ws "$URL_B" open https://github.com &
PID_B=$!

# Wait for both to complete
wait $PID_A
wait $PID_B

echo ""
echo "Both navigations complete. Checking URLs..."

# Check that each session has the correct URL
RESULT_A=$(./packages/cli/dist/index.js --session test-A --ws "$URL_A" get url)
RESULT_B=$(./packages/cli/dist/index.js --session test-B --ws "$URL_B" get url)

echo "[test-A] URL: $RESULT_A"
echo "[test-B] URL: $RESULT_B"

# Verify session isolation
if [[ "$RESULT_A" == *"example.com"* ]] && [[ "$RESULT_B" == *"github.com"* ]]; then
  echo ""
  echo "✅ SUCCESS: Session isolation working correctly!"
  echo "   - test-A is on example.com"
  echo "   - test-B is on github.com"
  echo "   - No cross-contamination detected"
else
  echo ""
  echo "❌ FAIL: Session contamination detected!"
  echo "   - test-A expected example.com, got: $RESULT_A"
  echo "   - test-B expected github.com, got: $RESULT_B"
  exit 1
fi

# Check daemon files
echo ""
echo "--- Checking Daemon Files ---"
ls -la /tmp/browse-test-A.* 2>/dev/null || true
ls -la /tmp/browse-test-B.* 2>/dev/null || true

# Check CDP URL storage
if [ -f "/tmp/browse-test-A.cdp" ]; then
  echo "[test-A] CDP URL stored: $(cat /tmp/browse-test-A.cdp)"
fi
if [ -f "/tmp/browse-test-B.cdp" ]; then
  echo "[test-B] CDP URL stored: $(cat /tmp/browse-test-B.cdp)"
fi

echo ""
echo "=== All Tests Passed! ==="
