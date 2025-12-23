#!/bin/bash
#
# Create a platform-native SEA binary from an already-prepared blob.
#
# Usage: ./scripts/create-binary.sh [platform]
#
# Platform options:
#   darwin-arm64  (default on Apple Silicon)
#   darwin-x64
#   linux-x64
#   win32-x64
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${PKG_DIR}/dist/sea"
BLOB_PATH="${DIST_DIR}/sea-prep.blob"

mkdir -p "${DIST_DIR}"

# Detect host platform/arch (SEA injection uses the host Node binary, so cross-building isn't supported).
HOST_OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
HOST_ARCH="$(uname -m)"

case "${HOST_OS}" in
  darwin)
    HOST_PLATFORM="darwin"
    ;;
  linux)
    HOST_PLATFORM="linux"
    ;;
  mingw*|msys*|cygwin*)
    HOST_PLATFORM="win32"
    ;;
  *)
    echo "Unknown OS: ${HOST_OS}" >&2
    exit 1
    ;;
esac

case "${HOST_ARCH}" in
  x86_64|amd64)
    HOST_ARCH="x64"
    ;;
  arm64|aarch64)
    HOST_ARCH="arm64"
    ;;
  *)
    echo "Unknown architecture: ${HOST_ARCH}" >&2
    exit 1
    ;;
esac

HOST_PLATFORM_ARCH="${HOST_PLATFORM}-${HOST_ARCH}"

PLATFORM_ARCH="${1:-${HOST_PLATFORM_ARCH}}"

if [[ "${PLATFORM_ARCH}" != "${HOST_PLATFORM_ARCH}" ]]; then
  echo "Cross-platform builds are not supported." >&2
  echo "Requested: ${PLATFORM_ARCH}" >&2
  echo "Host:      ${HOST_PLATFORM_ARCH}" >&2
  echo "Run this script on the target OS/arch or use CI artifacts." >&2
  exit 1
fi

if [[ "${PLATFORM_ARCH}" == win32* ]]; then
  BINARY_NAME="stagehand-server-${PLATFORM_ARCH}.exe"
else
  BINARY_NAME="stagehand-server-${PLATFORM_ARCH}"
fi

OUT_PATH="${DIST_DIR}/${BINARY_NAME}"

if [ ! -f "${BLOB_PATH}" ]; then
  echo "Missing ${BLOB_PATH}. Run 'pnpm --filter @browserbasehq/stagehand-server build:binary' first." >&2
  exit 1
fi

cp "$(command -v node)" "${OUT_PATH}"

case "${PLATFORM_ARCH}" in
  darwin-*)
    codesign --remove-signature "${OUT_PATH}" >/dev/null 2>&1 || true
    pnpm exec postject "${OUT_PATH}" NODE_SEA_BLOB "${BLOB_PATH}" \
      --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
      --macho-segment-name NODE_SEA
    codesign --sign - "${OUT_PATH}" >/dev/null 2>&1 || true
    ;;
  linux-*|win32-*)
    pnpm exec postject "${OUT_PATH}" NODE_SEA_BLOB "${BLOB_PATH}" \
      --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
    ;;
  *)
    echo "Unknown platform: ${PLATFORM_ARCH}" >&2
    exit 1
    ;;
esac

ls -lh "${OUT_PATH}"
