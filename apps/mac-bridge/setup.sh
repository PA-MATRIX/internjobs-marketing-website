#!/usr/bin/env bash
# Bootstrap the mac-bridge service on the Mac mini.
# Idempotent — safe to re-run after pulls.
set -euo pipefail

cd "$(dirname "$0")"

PLIST_LABEL="ai.internjobs.mac-bridge"
PLIST_SRC="$(pwd)/launchd/${PLIST_LABEL}.plist"
PLIST_DST="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
LOG_DIR="$HOME/Library/Logs"

# ---------------------------------------------------------------------------
# Prerequisites (manual — can't be automated)
# ---------------------------------------------------------------------------
# Before running this script, BlueBubbles Server must be installed and
# running on this Mac. mac-bridge talks to it over local HTTP + WebSocket.
#
# One-time setup (done interactively via NoMachine / direct console):
#
#   1. Download BlueBubbles-Server-macOS-x.y.z.dmg from
#        https://github.com/BlueBubblesApp/bluebubbles-server/releases
#      Drag BlueBubbles.app into /Applications.
#
#   2. Launch BlueBubbles.app. On first run, macOS will prompt for several
#      Privacy & Security permissions — grant all of them via
#        System Settings → Privacy & Security:
#
#        • Full Disk Access      — required to read ~/Library/Messages/chat.db
#        • Automation → System Events / Messages — required for AppleScript
#                                                   fallbacks (send, open chat)
#        • Accessibility         — required for the Private API helper to
#                                  inject typing / tapback / markRead into
#                                  Messages.app
#
#   3. Install the BlueBubbles Private API helper from the BlueBubbles UI
#        Settings → Private API → Install Helper.
#      This Mach-injects a small bundle into Messages.app. It is REVERSIBLE
#      (no kernel extension) and reversed by clicking "Uninstall Helper" or
#      reinstalling Messages.app. macOS SIP must be disabled — follow
#        https://docs.bluebubbles.app/private-api/installation
#      for the macOS-version-specific steps.
#
#   4. In BlueBubbles UI:
#        • Set a strong server password (this becomes BLUEBUBBLES_PASSWORD
#          in mac-bridge's .env).
#        • Confirm the HTTP service is bound to 127.0.0.1:1234 (default).
#        • Enable Private API features:
#            - Typing Indicators
#            - Read Receipts
#            - Tapbacks / Reactions
#            - Send With Effects (optional)
#
#   5. Verify BlueBubbles is responding:
#        curl "http://127.0.0.1:1234/api/v1/server/info?password=<your-password>"
#      Should return JSON server metadata.
# ---------------------------------------------------------------------------

if [ ! -f .env ]; then
  echo "ERROR: .env not found." >&2
  echo "  Copy .env.example to .env and fill in:" >&2
  echo "    BRIDGE_HMAC_SECRET            (shared with Fly /webhooks/mac-bridge)" >&2
  echo "    BRIDGE_OUTBOUND_WEBHOOK_URL   (e.g. https://app.internjobs.ai/webhooks/mac-bridge)" >&2
  echo "    BLUEBUBBLES_URL               (default http://127.0.0.1:1234)" >&2
  echo "    BLUEBUBBLES_PASSWORD          (the password you set in BlueBubbles UI)" >&2
  exit 1
fi

# Sanity check: BlueBubbles should be reachable before we start the bridge.
# Non-fatal — the bridge will retry on its own — but useful as a noisy hint.
echo "==> Probing BlueBubbles at 127.0.0.1:1234"
if ! curl -fsS --max-time 3 "http://127.0.0.1:1234/api/v1/server/info?password=$(grep -E '^BLUEBUBBLES_PASSWORD=' .env | head -1 | cut -d= -f2- | tr -d '\"')" >/dev/null 2>&1; then
  echo "  WARNING: BlueBubbles /api/v1/server/info not responding." >&2
  echo "           Make sure BlueBubbles.app is launched and the password matches." >&2
  echo "           The bridge will start anyway and retry the WebSocket on backoff." >&2
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
