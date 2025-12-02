#!/bin/bash

# CUA Primitives API Server - Startup Script
#
# Usage:
#   ./start.sh                    # Start with defaults
#   ./start.sh --port 8080        # Custom port
#   ./start.sh --host 127.0.0.1   # Custom host

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Export environment variables
export CUA_SERVER_PORT="$PORT"
export CUA_SERVER_HOST="$HOST"

echo "Starting CUA Primitives API Server..."
echo "  Host: $HOST"
echo "  Port: $PORT"
echo ""

# Run the server
cd "$SCRIPT_DIR"
npx tsx index.ts

