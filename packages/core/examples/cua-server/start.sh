#!/bin/bash

# CUA Primitives API Server - Startup Script
#
# Usage:
#   ./start.sh                    # Start with defaults
#   ./start.sh --port 8080        # Custom port
#   ./start.sh --host 127.0.0.1   # Custom host

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Node.js version (>= 18 required)
check_node_version() {
  if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is required but not installed.${NC}"
    echo "Install it from: https://nodejs.org/ (v18 or higher)"
    exit 1
  fi

  NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Error: Node.js v18 or higher is required.${NC}"
    echo "Current version: $(node -v)"
    echo "Please upgrade Node.js from: https://nodejs.org/"
    exit 1
  fi
  echo -e "${GREEN}✓${NC} Node.js $(node -v) detected"
}

# Check pnpm is installed
check_pnpm() {
  if ! command -v pnpm &> /dev/null; then
    echo -e "${RED}Error: pnpm is required but not installed.${NC}"
    echo ""
    echo "Install it with one of these methods:"
    echo "  npm install -g pnpm"
    echo "  brew install pnpm"
    echo "  curl -fsSL https://get.pnpm.io/install.sh | sh -"
    echo ""
    echo "More info: https://pnpm.io/installation"
    exit 1
  fi
  echo -e "${GREEN}✓${NC} pnpm $(pnpm -v) detected"
}

# Install dependencies if needed
install_dependencies() {
  if [ ! -d "node_modules" ]; then
    echo ""
    echo -e "${YELLOW}Installing dependencies...${NC}"
    pnpm install
    echo -e "${GREEN}✓${NC} Dependencies installed"
  fi
}

# Check for .env file
check_env_file() {
  if [ ! -f ".env" ]; then
    if [ -f "env.example" ]; then
      echo -e "${YELLOW}Note: No .env file found. Using environment variables or defaults.${NC}"
      echo "      Copy env.example to .env and customize if needed."
    fi
  else
    echo -e "${GREEN}✓${NC} .env file found"
  fi
}

# Default values
PORT="${CUA_SERVER_PORT:-3000}"
HOST="${CUA_SERVER_HOST:-0.0.0.0}"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --port|-p)
      PORT="$2"
      shift 2
      ;;
    --host|-h)
      HOST="$2"
      shift 2
      ;;
    --help)
      echo "CUA Primitives API Server"
      echo ""
      echo "Usage: ./start.sh [options]"
      echo ""
      echo "Options:"
      echo "  --port, -p PORT    Server port (default: 3000)"
      echo "  --host, -h HOST    Server host (default: 0.0.0.0)"
      echo "  --help             Show this help message"
      echo ""
      echo "Environment variables:"
      echo "  CUA_SERVER_PORT    Server port"
      echo "  CUA_SERVER_HOST    Server host"
      echo ""
      echo "Prerequisites:"
      echo "  - Node.js v18 or higher"
      echo "  - pnpm package manager"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║           CUA Primitives API Server - Setup                ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Run checks
check_node_version
check_pnpm
install_dependencies
check_env_file

# Export environment variables
export CUA_SERVER_PORT="$PORT"
export CUA_SERVER_HOST="$HOST"

echo ""
echo "Starting CUA Primitives API Server..."
echo "  Host: $HOST"
echo "  Port: $PORT"
echo ""

# Run the server with .env file support if it exists
if [ -f ".env" ]; then
  pnpm tsx --env-file=.env index.ts
else
  pnpm tsx index.ts
fi
