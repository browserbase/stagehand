#!/bin/bash
#
# Build a platform-native Node SEA binary for stagehand/server.
#
# Notes:
# - SEA injection uses the host Node executable, so cross-compiling isn't supported.
# - This script is intended for local dev and CI on the target OS/arch.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_DIR="$(cd "${PKG_DIR}/../.." && pwd)"

cd "${REPO_DIR}"
pnpm --filter @browserbasehq/stagehand build

cd "${PKG_DIR}"
mkdir -p dist/sea

pnpm exec esbuild src/server.ts \
  --bundle \
  --platform=node \
  --format=cjs \
  --outfile=dist/sea/bundle.cjs \
  --log-level=warning

node --experimental-sea-config sea-config.json

if [ ! -f "dist/sea/sea-prep.blob" ]; then
  echo "Missing dist/sea/sea-prep.blob; SEA blob generation failed." >&2
  exit 1
fi

bash scripts/create-binary.sh
