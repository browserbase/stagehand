#!/usr/bin/env bash
# Test 3: Concurrent sessions with different CDP URLs

set -e

STAGEHAND_CLI="/Users/shrey/Developer/stagehand-cli/packages/cli/dist/index.js"

echo "========================================="
echo "Test 3: Concurrent Session Isolation"
echo "========================================="
echo

# Check for required env vars
if [ -z "$BROWSERBASE_API_KEY" ] || [ -z "$BROWSERBASE_PROJECT_ID" ]; then
  echo "❌ FAIL: BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID must be set"
  exit 1
fi

if [ -z "$ANTHROPIC_API_KEY" ] && [ -z "$CLAUDE_API_KEY" ]; then
  echo "❌ FAIL: ANTHROPIC_API_KEY or CLAUDE_API_KEY must be set"
  exit 1
fi

export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-$CLAUDE_API_KEY}"

# Cleanup function
cleanup() {
  echo "Cleaning up all sessions..."
  node "$STAGEHAND_CLI" --session session-A stop 2>/dev/null || true
  node "$STAGEHAND_CLI" --session session-B stop 2>/dev/null || true
  node "$STAGEHAND_CLI" --session session-C stop 2>/dev/null || true
  rm -f /tmp/browse-session-*.* 2>/dev/null || true
}

trap cleanup EXIT

# Cleanup any existing sessions
cleanup
sleep 1

# Create 3 Browserbase sessions
echo "Creating 3 Browserbase sessions..."

create_session() {
  curl -s -X POST https://api.browserbase.com/v1/sessions \
    -H "Content-Type: application/json" \
    -H "X-BB-API-Key: $BROWSERBASE_API_KEY" \
    -d "{\"projectId\": \"$BROWSERBASE_PROJECT_ID\"}"
}

RESPONSE_A=$(create_session)
RESPONSE_B=$(create_session)
RESPONSE_C=$(create_session)

SESSION_ID_A=$(echo "$RESPONSE_A" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
CONNECT_URL_A=$(echo "$RESPONSE_A" | grep -o '"connectUrl":"[^"]*"' | head -1 | cut -d'"' -f4)

SESSION_ID_B=$(echo "$RESPONSE_B" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
CONNECT_URL_B=$(echo "$RESPONSE_B" | grep -o '"connectUrl":"[^"]*"' | head -1 | cut -d'"' -f4)

SESSION_ID_C=$(echo "$RESPONSE_C" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
CONNECT_URL_C=$(echo "$RESPONSE_C" | grep -o '"connectUrl":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$SESSION_ID_A" ] || [ -z "$SESSION_ID_B" ] || [ -z "$SESSION_ID_C" ]; then
  echo "❌ FAIL: Could not create Browserbase sessions"
  exit 1
fi

echo "✅ Session A: $SESSION_ID_A"
echo "✅ Session B: $SESSION_ID_B"
echo "✅ Session C: $SESSION_ID_C"
echo

# Run 3 concurrent commands with different sessions and URLs
echo "Running 3 concurrent commands..."
echo "  - Session A → example.com"
echo "  - Session B → github.com"
echo "  - Session C → google.com"
echo

START_TIME=$(date +%s)

# Run in parallel
(node "$STAGEHAND_CLI" --session session-A --ws "$CONNECT_URL_A" open https://example.com > /tmp/result-A.log 2>&1) &
PID_A=$!

(node "$STAGEHAND_CLI" --session session-B --ws "$CONNECT_URL_B" open https://github.com > /tmp/result-B.log 2>&1) &
PID_B=$!

(node "$STAGEHAND_CLI" --session session-C --ws "$CONNECT_URL_C" open https://google.com > /tmp/result-C.log 2>&1) &
PID_C=$!

# Wait for all to complete
wait $PID_A
EXIT_A=$?

wait $PID_B
EXIT_B=$?

wait $PID_C
EXIT_C=$?

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo "✅ All commands completed in ${DURATION}s"
echo

# Check results
echo "Verifying results..."

RESULT_A=$(cat /tmp/result-A.log)
RESULT_B=$(cat /tmp/result-B.log)
RESULT_C=$(cat /tmp/result-C.log)

echo "Session A result: $RESULT_A"
echo "Session B result: $RESULT_B"
echo "Session C result: $RESULT_C"
echo

# Verify each session went to correct URL
SUCCESS=true

if echo "$RESULT_A" | grep -q "example.com"; then
  echo "✅ Session A: Correctly navigated to example.com"
else
  echo "❌ Session A: Did not navigate to example.com"
  SUCCESS=false
fi

if echo "$RESULT_B" | grep -q "github.com"; then
  echo "✅ Session B: Correctly navigated to github.com"
else
  echo "❌ Session B: Did not navigate to github.com"
  SUCCESS=false
fi

if echo "$RESULT_C" | grep -q "google.com"; then
  echo "✅ Session C: Correctly navigated to google.com"
else
  echo "❌ Session C: Did not navigate to google.com"
  SUCCESS=false
fi

# Verify no cross-contamination by checking current URLs
echo
echo "Double-checking current URLs to verify no cross-contamination..."

URL_A=$(node "$STAGEHAND_CLI" --session session-A --ws "$CONNECT_URL_A" get url 2>&1)
URL_B=$(node "$STAGEHAND_CLI" --session session-B --ws "$CONNECT_URL_B" get url 2>&1)
URL_C=$(node "$STAGEHAND_CLI" --session session-C --ws "$CONNECT_URL_C" get url 2>&1)

echo "Session A current URL: $URL_A"
echo "Session B current URL: $URL_B"
echo "Session C current URL: $URL_C"
echo

if echo "$URL_A" | grep -q "example.com" && \
   echo "$URL_B" | grep -q "github.com" && \
   echo "$URL_C" | grep -q "google.com"; then
  echo "✅ No cross-contamination detected"
else
  echo "❌ Cross-contamination detected!"
  SUCCESS=false
fi

echo
if [ "$SUCCESS" = true ]; then
  echo "✅ Test 3 PASSED: Concurrent session isolation works correctly"
  exit 0
else
  echo "❌ Test 3 FAILED: Session isolation issues detected"
  exit 1
fi
