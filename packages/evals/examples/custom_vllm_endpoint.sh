#!/bin/bash
# Example script for running evals with a custom vLLM endpoint
#
# This demonstrates how to configure and use a custom OpenAI-compatible
# inference endpoint (like vLLM) with the Stagehand eval system.
#
# Prerequisites:
# 1. Have a vLLM server running (see setup instructions below)
# 2. Be in the packages/evals directory
#
# Usage:
#   ./examples/custom_vllm_endpoint.sh

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Stagehand Evals with Custom vLLM Endpoint ===${NC}\n"

# Configuration
VLLM_HOST="${VLLM_HOST:-localhost}"
VLLM_PORT="${VLLM_PORT:-8000}"
MODEL_NAME="${MODEL_NAME:-meta-llama/Llama-3.3-70B-Instruct}"

echo -e "${YELLOW}Configuration:${NC}"
echo "  vLLM Host: $VLLM_HOST"
echo "  vLLM Port: $VLLM_PORT"
echo "  Model: $MODEL_NAME"
echo ""

# Check if vLLM server is reachable
echo -e "${BLUE}Checking vLLM server connectivity...${NC}"
if curl -s -f "http://${VLLM_HOST}:${VLLM_PORT}/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ vLLM server is reachable${NC}\n"
else
    echo -e "${YELLOW}Warning: Could not reach vLLM server at http://${VLLM_HOST}:${VLLM_PORT}${NC}"
    echo "Please ensure your vLLM server is running."
    echo ""
    echo "To start a vLLM server, run:"
    echo "  vllm serve $MODEL_NAME --host 0.0.0.0 --port $VLLM_PORT"
    echo ""
    echo "Continuing anyway (will fail if server is not available)..."
    echo ""
fi

# Set environment variables for custom endpoint
export CUSTOM_OPENAI_BASE_URL="http://${VLLM_HOST}:${VLLM_PORT}/v1"
export CUSTOM_OPENAI_API_KEY="EMPTY"
export CUSTOM_OPENAI_MODEL_NAME="$MODEL_NAME"

echo -e "${BLUE}Environment variables set:${NC}"
echo "  CUSTOM_OPENAI_BASE_URL=$CUSTOM_OPENAI_BASE_URL"
echo "  CUSTOM_OPENAI_API_KEY=$CUSTOM_OPENAI_API_KEY"
echo "  CUSTOM_OPENAI_MODEL_NAME=$CUSTOM_OPENAI_MODEL_NAME"
echo ""

# Run the evals
echo -e "${BLUE}Running evals with custom endpoint...${NC}\n"

# You can customize which eval to run by passing arguments
# Examples:
#   ./examples/custom_vllm_endpoint.sh --eval hn_aisdk
#   ./examples/custom_vllm_endpoint.sh --category extract
#   ./examples/custom_vllm_endpoint.sh --category act

pnpm run evals "$@"

echo -e "\n${GREEN}=== Eval run completed ===${NC}"

