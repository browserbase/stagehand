#!/bin/bash
export ANTHROPIC_API_KEY=${CLAUDE_API_KEY}

# Create a Browserbase session
echo "Creating Browserbase session..."
RESPONSE=$(curl -s -X POST https://api.browserbase.com/v1/sessions \
  -H "Content-Type: application/json" \
  -H "X-BB-API-Key: $BROWSERBASE_API_KEY" \
  -d "{\"projectId\": \"$BROWSERBASE_PROJECT_ID\"}")

SESSION_ID=$(echo "$RESPONSE" | jq -r '.id')
CONNECT_URL=$(echo "$RESPONSE" | jq -r '.connectUrl')

echo "Session ID: $SESSION_ID"
echo "Connect URL: ${CONNECT_URL:0:50}..."
echo ""

# Test with the CLI
echo "Testing stagehand with --session and --ws flags..."
./packages/cli/dist/index.js --session test-demo --ws "$CONNECT_URL" open https://example.com

echo ""
echo "Getting current URL..."
./packages/cli/dist/index.js --session test-demo --ws "$CONNECT_URL" get url

echo ""
echo "Checking daemon status..."
./packages/cli/dist/index.js --session test-demo status
