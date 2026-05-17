#!/usr/bin/env bash
# Bootstrap the mac-bridge service on the Mac mini.
# Idempotent — safe to re-run after pulls.
set -euo pipefail

cd "$(dirname "$0")"

PLIST_LABEL="ai.internjobs.mac-bridge"
PLIST_SRC="$(pwd)/launchd/${PLIST_LABEL}.plist"
PLIST_DST="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
LOG_DIR="$HOME/Library/Logs"

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Copy .env.example and fill in BRIDGE_HMAC_SECRET + BRIDGE_OUTBOUND_WEBHOOK_URL before running setup." >&2
  exit 1
fi

echo "==> Installing npm dependencies"
npm install --omit=dev

echo "==> Ensuring log dir exists"
mkdir -p "$LOG_DIR"

echo "==> Installing LaunchAgent"
mkdir -p "$HOME/Library/LaunchAgents"
cp "$PLIST_SRC" "$PLIST_DST"

echo "==> (Re)loading service"
launchctl bootout "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl kickstart -k "gui/$(id -u)/${PLIST_LABEL}"

echo "==> Tail logs (Ctrl-C to stop):"
sleep 1
tail -n 30 -f "$LOG_DIR/internjobs-mac-bridge.out.log" "$LOG_DIR/internjobs-mac-bridge.err.log"
