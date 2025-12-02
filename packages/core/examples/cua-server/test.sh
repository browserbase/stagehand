#!/bin/bash

# CUA Primitives API Server - Canary Test
#
# This script tests the basic functionality of the CUA server.
# Run after starting the server with ./start.sh
#
# Usage:
#   ./test.sh                     # Test against localhost:3000
#   ./test.sh http://localhost:8080  # Custom server URL

set -e

BASE_URL="${1:-http://localhost:3000}"

echo "============================================"
echo "CUA Primitives API Server - Canary Test"
echo "============================================"
echo "Server: $BASE_URL"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass() {
  echo -e "${GREEN}✓ PASS${NC}: $1"
}

fail() {
  echo -e "${RED}✗ FAIL${NC}: $1"
  exit 1
}

info() {
  echo -e "${YELLOW}→${NC} $1"
}

# Test 1: Health check
info "Testing health endpoint..."
HEALTH=$(curl -s "$BASE_URL/health")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  pass "Health check"
else
  fail "Health check - unexpected response: $HEALTH"
fi

# Test 2: List sessions (should be empty or have sessions)
info "Testing list sessions..."
SESSIONS=$(curl -s "$BASE_URL/sessions")
if echo "$SESSIONS" | grep -q '"sessions"'; then
  pass "List sessions"
else
  fail "List sessions - unexpected response: $SESSIONS"
fi

# Test 3: Create a session
info "Creating browser session..."
CREATE_RESPONSE=$(curl -s -X POST "$BASE_URL/sessions" \
  -H "Content-Type: application/json" \
  -d '{"env": "LOCAL"}')

SESSION_ID=$(echo "$CREATE_RESPONSE" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)

if [ -z "$SESSION_ID" ]; then
  fail "Create session - no sessionId in response: $CREATE_RESPONSE"
fi

if echo "$CREATE_RESPONSE" | grep -q '"screenshot"'; then
  pass "Create session (ID: $SESSION_ID)"
else
  fail "Create session - missing screenshot in response"
fi

# Test 4: Get session state
info "Getting session state..."
STATE=$(curl -s "$BASE_URL/sessions/$SESSION_ID/state")
if echo "$STATE" | grep -q '"screenshot"'; then
  pass "Get session state"
else
  fail "Get session state - unexpected response: $STATE"
fi

# Test 5: Navigate to example.com
info "Testing goto action..."
GOTO_RESPONSE=$(curl -s -X POST "$BASE_URL/sessions/$SESSION_ID/action" \
  -H "Content-Type: application/json" \
  -d '{"type": "goto", "url": "https://example.com"}')

if echo "$GOTO_RESPONSE" | grep -q '"success":true'; then
  pass "Goto action"
else
  fail "Goto action - unexpected response: $GOTO_RESPONSE"
fi

# Verify URL changed
if echo "$GOTO_RESPONSE" | grep -q 'example.com'; then
  pass "URL updated to example.com"
else
  fail "URL not updated - response: $GOTO_RESPONSE"
fi

# Test 6: Click action
info "Testing click action..."
CLICK_RESPONSE=$(curl -s -X POST "$BASE_URL/sessions/$SESSION_ID/action" \
  -H "Content-Type: application/json" \
  -d '{"type": "click", "x": 100, "y": 100}')

if echo "$CLICK_RESPONSE" | grep -q '"success":true'; then
  pass "Click action"
else
  fail "Click action - unexpected response: $CLICK_RESPONSE"
fi

# Test 7: Scroll action
info "Testing scroll action..."
SCROLL_RESPONSE=$(curl -s -X POST "$BASE_URL/sessions/$SESSION_ID/action" \
  -H "Content-Type: application/json" \
  -d '{"type": "scroll", "x": 640, "y": 360, "scroll_y": 100}')

if echo "$SCROLL_RESPONSE" | grep -q '"success":true'; then
  pass "Scroll action"
else
  fail "Scroll action - unexpected response: $SCROLL_RESPONSE"
fi

# Test 8: Wait action
info "Testing wait action..."
WAIT_RESPONSE=$(curl -s -X POST "$BASE_URL/sessions/$SESSION_ID/action" \
  -H "Content-Type: application/json" \
  -d '{"type": "wait", "timeMs": 500}')

if echo "$WAIT_RESPONSE" | grep -q '"success":true'; then
  pass "Wait action"
else
  fail "Wait action - unexpected response: $WAIT_RESPONSE"
fi

# Test 9: Keypress action
info "Testing keypress action..."
KEYPRESS_RESPONSE=$(curl -s -X POST "$BASE_URL/sessions/$SESSION_ID/action" \
  -H "Content-Type: application/json" \
  -d '{"type": "keypress", "keys": "Tab"}')

if echo "$KEYPRESS_RESPONSE" | grep -q '"success":true'; then
  pass "Keypress action"
else
  fail "Keypress action - unexpected response: $KEYPRESS_RESPONSE"
fi

# Test 10: Delete session
info "Deleting session..."
DELETE_RESPONSE=$(curl -s -X DELETE "$BASE_URL/sessions/$SESSION_ID")

if echo "$DELETE_RESPONSE" | grep -q '"success":true'; then
  pass "Delete session"
else
  fail "Delete session - unexpected response: $DELETE_RESPONSE"
fi

# Test 11: Verify session is gone
info "Verifying session deleted..."
GONE_RESPONSE=$(curl -s "$BASE_URL/sessions/$SESSION_ID/state")

if echo "$GONE_RESPONSE" | grep -q 'SESSION_NOT_FOUND'; then
  pass "Session properly deleted"
else
  fail "Session still exists after deletion"
fi

echo ""
echo "============================================"
echo -e "${GREEN}All tests passed!${NC}"
echo "============================================"

