#!/bin/bash
set -e

EXT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Detect Chrome binary
if [[ "$OSTYPE" == "darwin"* ]]; then
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
elif command -v google-chrome-stable &>/dev/null; then
  CHROME="google-chrome-stable"
elif command -v google-chrome &>/dev/null; then
  CHROME="google-chrome"
elif command -v chromium-browser &>/dev/null; then
  CHROME="chromium-browser"
elif command -v chromium &>/dev/null; then
  CHROME="chromium"
else
  echo "Chrome not found" && exit 1
fi

"$CHROME" \
  --no-first-run \
  --disable-default-apps \
  --remote-debugging-port=9222 \
  --load-extension="$EXT_DIR" \
  --disable-extensions-except="$EXT_DIR" \
  "$@"
