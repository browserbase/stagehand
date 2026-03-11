#!/usr/bin/env bash
set -euo pipefail

DISPLAY_NUM="${DISPLAY_NUM:-:99}"
VNC_PORT="${VNC_PORT:-5901}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
SCREEN_GEOMETRY="${SCREEN_GEOMETRY:-1920x1080x24}"

mkdir -p /tmp/browser-desktop

# Stop old instances from previous runs.
pkill -f "Xvfb ${DISPLAY_NUM}" 2>/dev/null || true
pkill -f "x11vnc .*${VNC_PORT}" 2>/dev/null || true
pkill -f "websockify .*${NOVNC_PORT}" 2>/dev/null || true
pkill -f "fluxbox" 2>/dev/null || true

Xvfb "${DISPLAY_NUM}" -screen 0 "${SCREEN_GEOMETRY}" -ac +extension RANDR > /tmp/browser-desktop/xvfb.log 2>&1 &
export DISPLAY="${DISPLAY_NUM}"

# Give Xvfb a moment to boot before starting WM and VNC.
sleep 1

fluxbox > /tmp/browser-desktop/fluxbox.log 2>&1 &
x11vnc -display "${DISPLAY}" -forever -shared -rfbport "${VNC_PORT}" -nopw > /tmp/browser-desktop/x11vnc.log 2>&1 &
websockify --web /usr/share/novnc "${NOVNC_PORT}" "localhost:${VNC_PORT}" > /tmp/browser-desktop/novnc.log 2>&1 &

echo "Desktop started."
echo "Display: ${DISPLAY}"
echo "VNC port: ${VNC_PORT}"
echo "noVNC port: ${NOVNC_PORT}"

if [[ -n "${CODESPACE_NAME:-}" && -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
  echo "Open in your local browser:"
  echo "https://${CODESPACE_NAME}-${NOVNC_PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}/vnc.html"
else
  echo "Open via forwarded port ${NOVNC_PORT}: /vnc.html"
fi

echo "Then run your browser script with: DISPLAY=${DISPLAY} CHROME_PATH=/usr/bin/google-chrome python <script.py>"
