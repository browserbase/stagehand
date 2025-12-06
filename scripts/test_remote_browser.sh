#!/usr/bin/env bash

# Smoke test the Stagehand Fastify server using a Browserbase browser.
# By default uses localhost, but can be run with --prod to target production.

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for this script. Install it (brew install jq) and re-run." >&2
  exit 1
fi

# Load .env file if it exists (skip comment lines starting with ; or #)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  set -a
  # Filter out comments (lines starting with ; or #) and empty lines, then source
  source <(grep -v '^[[:space:]]*[;#]' "${SCRIPT_DIR}/.env" | grep -v '^[[:space:]]*$')
  set +a
fi

# Parse command line arguments
USE_PROD=false
for arg in "$@"; do
  case $arg in
    --prod)
      USE_PROD=true
      shift
      ;;
    *)
      # Unknown option
      ;;
  esac
done

# Set BASE_URL based on flag
if [[ "${USE_PROD}" == "true" ]]; then
  BASE_URL="https://api.stagehand.browserbase.com/v1"
else
  BASE_URL="http://127.0.0.1:3000/v1"
fi

MODEL_NAME="${MODEL_NAME:-openai/gpt-4.1-mini}"
MODEL_API_KEY="${MODEL_API_KEY:-${OPENAI_API_KEY:-}}"
BB_API_KEY="${BROWSERBASE_API_KEY:-}"
BB_PROJECT_ID="${BROWSERBASE_PROJECT_ID:-}"

if [[ -z "${MODEL_API_KEY}" ]]; then
  echo "Set MODEL_API_KEY or OPENAI_API_KEY so we can pass x-model-api-key to the server." >&2
  exit 1
fi

# When using prod, check for Browserbase credentials
if [[ "${USE_PROD}" == "true" ]]; then
  if [[ -z "${BB_API_KEY}" ]]; then
    echo "Set BROWSERBASE_API_KEY in .env file or environment to use --prod flag." >&2
    exit 1
  fi
  
  if [[ -z "${BB_PROJECT_ID}" ]]; then
    echo "Set BROWSERBASE_PROJECT_ID in .env file or environment to use --prod flag." >&2
    exit 1
  fi
fi

# For local Browserbase mode, also check credentials
if [[ "${USE_PROD}" != "true" ]]; then
  if [[ -z "${BB_API_KEY}" || -z "${BB_PROJECT_ID}" ]]; then
    echo "Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID to target Browserbase mode." >&2
    exit 1
  fi
fi

echo "Using Stagehand base URL: ${BASE_URL}"
echo "Using model: ${MODEL_NAME}"
echo "Using Browserbase project: ${BB_PROJECT_ID}"

call_stagehand() {
  local route="$1"
  local payload="$2"

  >&2 echo
  >&2 echo ">>> POST ${route}"
  >&2 echo "${payload}"

  curl -sS -X POST "${BASE_URL}${route}" \
    -H "Content-Type: application/json" \
    -H "x-stream-response: false" \
    -H "x-model-api-key: ${MODEL_API_KEY}" \
    -H "x-bb-api-key: ${BB_API_KEY}" \
    -H "x-bb-project-id: ${BB_PROJECT_ID}" \
    -d "${payload}"
}

VERBOSE_LEVEL="${STAGEHAND_VERBOSE:-2}"
START_PAYLOAD=$(jq -n \
  --arg model "${MODEL_NAME}" \
  --argjson verbose "${VERBOSE_LEVEL}" \
  --arg project "${BB_PROJECT_ID}" \
  '{
    env: "BROWSERBASE",
    modelName: $model,
    verbose: $verbose,
    browserbaseSessionCreateParams: {
      projectId: $project,
      browserSettings: { viewport: { width: 1288, height: 711 } },
      userMetadata: { stagehand: "true", smokeTest: "remote" }
    }
  }')

START_RESPONSE=$(call_stagehand "/sessions/start" "${START_PAYLOAD}")
SESSION_ID=$(echo "${START_RESPONSE}" | jq -r '.data.sessionId')

if [[ -z "${SESSION_ID}" || "${SESSION_ID}" == "null" ]]; then
  echo "Failed to start session; raw response:" >&2
  echo "${START_RESPONSE}" >&2
  exit 1
fi

echo "Session ID: ${SESSION_ID}"

ACT_ROUTE="/sessions/${SESSION_ID}/act"
OBS_ROUTE="/sessions/${SESSION_ID}/observe"
NAV_ROUTE="/sessions/${SESSION_ID}/navigate"

TARGET_URL="${TARGET_URL:-https://browserbase.github.io/stagehand-eval-sites/sites/iframe-form-filling/}"

NAVIGATE_BODY=$(jq -n --arg url "${TARGET_URL}" '{url: $url, options: { waitUntil: "load" }}')
call_stagehand "${NAV_ROUTE}" "${NAVIGATE_BODY}" | jq .
call_stagehand "${ACT_ROUTE}" '{"input":"Type Stagehand Bot into the field labeled \"Your name\"","options":{"timeout":45000}}' | jq .
call_stagehand "${OBS_ROUTE}" '{"instruction":"List the placeholders for every text field on the page.","options":{"timeout":30000}}' | jq .
call_stagehand "${ACT_ROUTE}" '{"input":"Scroll to the bottom of the page","options":{"timeout":30000}}' | jq .

END_ROUTE="/sessions/${SESSION_ID}/end"
call_stagehand "${END_ROUTE}" '{}' | jq .

echo
echo "Browserbase Stagehand server smoke test finished."
