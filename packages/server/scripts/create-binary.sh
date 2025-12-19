#!/bin/bash
#
# Creates a platform-specific SEA binary from the prepared blob
#
# Usage: ./scripts/create-binary.sh [platform]
#
# Platform options:
#   darwin-arm64  (default on Apple Silicon)
#   darwin-x64
#   linux-x64
#   win32-x64
#
# If no platform specified, auto-detects current platform

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${PKG_DIR}/dist/sea"
BLOB_PATH="${DIST_DIR}/sea-prep.blob"

mkdir -p "${DIST_DIR}"

# Detect host platform/arch (SEA injection uses the host Node binary, so cross-building isn't supported)
HOST_OS=$(uname -s | tr '[:upper:]' '[:lower:]')
HOST_ARCH=$(uname -m)

case "$HOST_OS" in
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
        echo "Unknown OS: $HOST_OS"
        exit 1
        ;;
esac

case "$HOST_ARCH" in
    x86_64|amd64)
        HOST_ARCH="x64"
        ;;
    arm64|aarch64)
        HOST_ARCH="arm64"
        ;;
    *)
        echo "Unknown architecture: $HOST_ARCH"
        exit 1
        ;;
esac

HOST_PLATFORM_ARCH="${HOST_PLATFORM}-${HOST_ARCH}"

# Auto-detect platform if not specified
if [ -z "$1" ]; then
    PLATFORM_ARCH="${HOST_PLATFORM_ARCH}"
else
    PLATFORM_ARCH="$1"
fi

# Reject cross-target builds; the output binary must match the host Node executable.
if [[ "${PLATFORM_ARCH}" != "${HOST_PLATFORM_ARCH}" ]]; then
    echo "Cross-platform builds are not supported."
    echo "Requested: ${PLATFORM_ARCH}"
    echo "Host:      ${HOST_PLATFORM_ARCH}"
    echo "Run this script on the target OS/arch or use CI artifacts."
    exit 1
fi

# Set binary name
if [[ "$PLATFORM_ARCH" == win32* ]]; then
    BINARY_NAME="stagehand-${PLATFORM_ARCH}.exe"
else
    BINARY_NAME="stagehand-${PLATFORM_ARCH}"
fi

OUT_PATH="${DIST_DIR}/${BINARY_NAME}"

echo "Building binary: $BINARY_NAME"
echo "================================"

# Check blob exists
if [ ! -f "${BLOB_PATH}" ]; then
    echo "Error: ${BLOB_PATH} not found. Run 'pnpm build:binary' first."
    exit 1
fi

# Copy node binary
echo "Copying Node.js binary..."
cp "$(which node)" "${OUT_PATH}"

# Platform-specific injection
case "$PLATFORM_ARCH" in
    darwin-*)
        echo "Removing existing signature (macOS)..."
        codesign --remove-signature "${OUT_PATH}"

        echo "Injecting SEA blob..."
        pnpm exec postject "${OUT_PATH}" NODE_SEA_BLOB "${BLOB_PATH}" \
            --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
            --macho-segment-name NODE_SEA

        echo "Re-signing binary (macOS)..."
        codesign --sign - "${OUT_PATH}"
        ;;
    linux-*)
        echo "Injecting SEA blob..."
        pnpm exec postject "${OUT_PATH}" NODE_SEA_BLOB "${BLOB_PATH}" \
            --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
        ;;
    win32-*)
        echo "Injecting SEA blob..."
        pnpm exec postject "${OUT_PATH}" NODE_SEA_BLOB "${BLOB_PATH}" \
            --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
        ;;
    *)
        echo "Unknown platform: $PLATFORM_ARCH"
        exit 1
        ;;
esac

# Show result
echo ""
echo "================================"
echo "Binary created successfully!"
echo ""
ls -lh "${OUT_PATH}"
echo ""
echo "Run with:"
echo "  OPENAI_API_KEY=sk-xxx ${OUT_PATH}"
