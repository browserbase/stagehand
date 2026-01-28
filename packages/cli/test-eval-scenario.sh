#!/usr/bin/env bash
# Test 4: Eval scenario - testing with wrapper and env vars

set -e

WRAPPER="/Users/shrey/Developer/browserbase-skills/stagehand-wrapper.sh"
TEST_SESSION="eval-test-123"

echo "========================================="
echo "Test 4: Eval Scenario (Wrapper + Env Vars)"
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
  echo "Cleaning up..."
  bash "$WRAPPER" stop 2>/dev/null || true
  rm -f /tmp/browse-${TEST_SESSION}.* 2>/dev/null || true
}

trap cleanup EXIT

cleanup
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
  exit 1
fi

echo "✅ Browserbase session created: $SESSION_ID"
echo

# Set env vars like eval framework does
export STAGEHAND_SESSION="$TEST_SESSION"
export BROWSERBASE_CONNECT_URL="$CONNECT_URL"

echo "Testing wrapper with env vars:"
echo "  STAGEHAND_SESSION=$STAGEHAND_SESSION"
echo "  BROWSERBASE_CONNECT_URL=${BROWSERBASE_CONNECT_URL:0:60}..."
echo

# Test 1: Wrapper auto-injects flags even without explicit --session and --ws
echo "Test 1: Wrapper auto-injects flags"
echo "Running: stagehand open https://example.com (no explicit flags)"

START_TIME=$(date +%s%N)

RESULT=$(bash "$WRAPPER" open https://example.com 2>&1) || {
  echo "❌ FAIL: Command failed"
  echo "Output: $RESULT"
  exit 1
}

END_TIME=$(date +%s%N)
DURATION_MS=$(( (END_TIME - START_TIME) / 1000000 ))

echo "✅ Command completed in ${DURATION_MS}ms"
echo "Result: $RESULT"
echo

if echo "$RESULT" | grep -q "example.com"; then
  echo "✅ Navigation successful with auto-injected flags"
else
  echo "❌ FAIL: Navigation failed"
  exit 1
fi

# Test 2: Verify session isolation with wrapper
echo "Test 2: Session isolation via wrapper"

URL=$(bash "$WRAPPER" get url 2>&1)
echo "Current URL: $URL"
echo

if echo "$URL" | grep -q "example.com"; then
  echo "✅ Session maintained correctly"
else
  echo "❌ FAIL: Session not maintained"
  exit 1
fi

# Test 3: Verify wrapper uses correct session name
echo "Test 3: Verify correct session name used"

STATUS=$(bash "$WRAPPER" status 2>&1)
echo "Status: $STATUS"
echo

if echo "$STATUS" | grep -q "$TEST_SESSION"; then
  echo "✅ Correct session name used: $TEST_SESSION"
else
  echo "❌ FAIL: Wrong session name"
  exit 1
fi

# Test 4: Verify session files exist
echo "Test 4: Verify session files exist"

if [ -f "/tmp/browse-${TEST_SESSION}.sock" ] && [ -f "/tmp/browse-${TEST_SESSION}.pid" ]; then
  echo "✅ Session files created correctly"
else
  echo "❌ FAIL: Session files not found"
  ls -la /tmp/browse-${TEST_SESSION}.* 2>/dev/null || echo "No files found"
  exit 1
fi

echo
echo "✅ Test 4 PASSED: Eval scenario works correctly"
echo "   - Wrapper auto-injects flags from env vars"
echo "   - Session isolation maintained"
echo "   - Lazy initialization works with wrapper"
echo "   - Daemon startup was instant (${DURATION_MS}ms for first command)"
