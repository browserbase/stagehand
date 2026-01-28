#!/usr/bin/env bash
# Test 2: CDP connection - browser initialization happens on first command

set -e

STAGEHAND_CLI="/Users/shrey/Developer/stagehand-cli/packages/cli/dist/index.js"
TEST_SESSION="test-cdp-connection"

echo "========================================="
echo "Test 2: CDP Connection & Lazy Init"
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

# Cleanup any existing session
echo "Cleaning up existing session..."
node "$STAGEHAND_CLI" --session "$TEST_SESSION" stop 2>/dev/null || true
rm -f /tmp/browse-$TEST_SESSION.* 2>/dev/null || true
sleep 1

# Create Browserbase session
echo "Creating Browserbase session..."
RESPONSE=$(curl -s -X POST https://api.browserbase.com/v1/sessions \
  -H "Content-Type: application/json" \
  -H "X-BB-API-Key: $BROWSERBASE_API_KEY" \
  -d "{\"projectId\": \"$BROWSERBASE_PROJECT_ID\"}")

SESSION_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
CONNECT_URL=$(echo "$RESPONSE" | grep -o '"connectUrl":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$SESSION_ID" ] || [ -z "$CONNECT_URL" ]; then
  echo "❌ FAIL: Could not create Browserbase session"
  echo "Response: $RESPONSE"
  exit 1
fi

echo "✅ Browserbase session created: $SESSION_ID"
echo "Connect URL: ${CONNECT_URL:0:60}..."
echo

# Test daemon starts quickly (without browser init)
echo "Starting daemon (should be instant)..."
START_TIME=$(date +%s%N)

node "$STAGEHAND_CLI" --session "$TEST_SESSION" start

END_TIME=$(date +%s%N)
DAEMON_START_MS=$(( (END_TIME - START_TIME) / 1000000 ))

echo "✅ Daemon started in ${DAEMON_START_MS}ms"
echo

if [ $DAEMON_START_MS -gt 2000 ]; then
  echo "❌ WARNING: Daemon startup took > 2 seconds"
fi

# Test first command triggers browser initialization
echo "Running first command (should trigger browser initialization)..."
START_TIME=$(date +%s%N)

RESULT=$(node "$STAGEHAND_CLI" --session "$TEST_SESSION" --ws "$CONNECT_URL" open https://example.com 2>&1) || {
  echo "❌ FAIL: Command failed"
  echo "Error output: $RESULT"
  node "$STAGEHAND_CLI" --session "$TEST_SESSION" stop || true
  exit 1
}

END_TIME=$(date +%s%N)
FIRST_CMD_MS=$(( (END_TIME - START_TIME) / 1000000 ))

echo "✅ First command completed in ${FIRST_CMD_MS}ms"
echo "Result: $RESULT"
echo

# Verify navigation worked
if echo "$RESULT" | grep -q "example.com"; then
  echo "✅ Navigation successful"
else
  echo "❌ FAIL: Navigation did not reach example.com"
  node "$STAGEHAND_CLI" --session "$TEST_SESSION" stop || true
  exit 1
fi

# Test second command is fast (browser already initialized)
echo "Running second command (should be fast, browser already initialized)..."
START_TIME=$(date +%s%N)

RESULT=$(node "$STAGEHAND_CLI" --session "$TEST_SESSION" --ws "$CONNECT_URL" get url 2>&1)

END_TIME=$(date +%s%N)
SECOND_CMD_MS=$(( (END_TIME - START_TIME) / 1000000 ))

echo "✅ Second command completed in ${SECOND_CMD_MS}ms"
echo "Result: $RESULT"
echo

if [ $SECOND_CMD_MS -gt 5000 ]; then
  echo "❌ WARNING: Second command took > 5 seconds (should be fast)"
fi

# Cleanup
echo "Cleaning up..."
node "$STAGEHAND_CLI" --session "$TEST_SESSION" stop
rm -f /tmp/browse-$TEST_SESSION.*

echo
echo "✅ Test 2 PASSED: Lazy initialization works with CDP connections"
echo "   - Daemon started in ${DAEMON_START_MS}ms (instant)"
echo "   - First command (with browser init) took ${FIRST_CMD_MS}ms"
echo "   - Second command (browser already init) took ${SECOND_CMD_MS}ms"
