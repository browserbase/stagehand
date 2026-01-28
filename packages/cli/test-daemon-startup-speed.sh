#!/usr/bin/env bash
# Test 1: Daemon startup speed - should be instant with lazy initialization

set -e

STAGEHAND_CLI="/Users/shrey/Developer/stagehand-cli/packages/cli/dist/index.js"
TEST_SESSION="test-startup-speed"

echo "========================================="
echo "Test 1: Daemon Startup Speed"
echo "========================================="
echo

# Cleanup any existing session
echo "Cleaning up existing session..."
node "$STAGEHAND_CLI" --session "$TEST_SESSION" stop 2>/dev/null || true
rm -f /tmp/browse-$TEST_SESSION.* 2>/dev/null || true
sleep 1

# Measure daemon startup time
echo "Starting daemon and measuring startup time..."
START_TIME=$(date +%s%N)

node "$STAGEHAND_CLI" --session "$TEST_SESSION" start

END_TIME=$(date +%s%N)
DURATION_MS=$(( (END_TIME - START_TIME) / 1000000 ))

echo
echo "✅ Daemon started in ${DURATION_MS}ms"
echo

if [ $DURATION_MS -lt 1000 ]; then
  echo "✅ SUCCESS: Startup time < 1 second (lazy initialization working)"
else
  echo "❌ FAIL: Startup time >= 1 second (expected instant startup)"
  exit 1
fi

# Check daemon is running
echo "Verifying daemon is running..."
STATUS=$(node "$STAGEHAND_CLI" --session "$TEST_SESSION" status)
echo "Status: $STATUS"

if echo "$STATUS" | grep -q '"running":true'; then
  echo "✅ Daemon is running"
else
  echo "❌ Daemon not running"
  exit 1
fi

# Cleanup
echo
echo "Cleaning up..."
node "$STAGEHAND_CLI" --session "$TEST_SESSION" stop
rm -f /tmp/browse-$TEST_SESSION.*

echo
echo "✅ Test 1 PASSED: Daemon startup is instant with lazy initialization"
