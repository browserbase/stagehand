#!/bin/bash
#
# Build Stagehand Server SEA Binary
# Full build from scratch with progress logging
#

set -euo pipefail

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Logging functions
step() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${CYAN}▶ $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

success() {
    echo -e "${GREEN}✓ $1${NC}"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_DIR="$(cd "${PKG_DIR}/../.." && pwd)"

# Start
echo ""
echo -e "${BOLD}${CYAN}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║   Stagehand Server SEA Binary Builder             ║${NC}"
echo -e "${BOLD}${CYAN}╚═══════════════════════════════════════════════════╝${NC}"

# Step 1: Install root dependencies
step "Installing monorepo dependencies..."
cd "${REPO_DIR}"
if [[ "${CI:-}" == "true" ]]; then
    pnpm install --frozen-lockfile --silent
else
    pnpm install --silent
fi
success "Monorepo dependencies installed"

# Step 2: Build Stagehand core
step "Building Stagehand core..."
pnpm --filter @browserbasehq/stagehand build
success "Stagehand core built"

# Step 3: Bundle + generate SEA blob
step "Bundling server and generating SEA blob..."
cd "${PKG_DIR}"
node -e "require('fs').mkdirSync('dist/sea',{recursive:true})"
pnpm exec esbuild src/server.ts --bundle --platform=node --format=cjs --outfile=dist/sea/bundle.cjs --log-level=warning
node --experimental-sea-config sea-config.json
success "SEA blob generated"

# Step 4: Create binary
step "Creating standalone binary..."
./scripts/create-binary.sh 2>&1 | tail -n 10

# Done!
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Build Complete!                      ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════╝${NC}"
echo ""

# Show binary info
BINARY=$(ls -1 dist/sea/stagehand-* 2>/dev/null | head -1)
if [ -n "$BINARY" ]; then
    BINARY_SIZE=$(ls -lh "$BINARY" | awk '{print $5}')
    echo -e "${BOLD}Binary:${NC} $BINARY (${BINARY_SIZE})"
    echo ""
    echo -e "  ${CYAN}OPENAI_API_KEY=sk-xxx ./$BINARY${NC}"
    echo ""
fi
