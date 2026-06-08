#!/usr/bin/env bash
# ============================================================================
# 25-01-mmctl-commands.sh
# ----------------------------------------------------------------------------
# Phase 25-01 — Mattermost OIDC SSO activation (MMSSO-01).
#
# Configures Mattermost Team Edition to trust the Parrot Worker's OIDC bridge
# (apps/parrot/workers/routes/oidc.ts) by setting the seven GitLabSettings
# config keys via mmctl. Mattermost speaks OAuth 2.0 via the "GitLab OAuth"
# integration shape — these keys point that integration at our /oidc/* mount.
#
# RUN THIS ONLY FROM A MACHINE WHERE:
#   1. `mmctl` is installed and authenticated against chat.internjobs.ai
#      (verify with `mmctl auth list`).
#   2. The Mattermost admin account used by mmctl has system_admin role.
#
# Mark executable: chmod +x apps/parrot/test/25-01-mmctl-commands.sh
# (Git note: committed with mode 100755 via `git update-index --chmod=+x`.)
#
# NO SECRETS ARE HARDCODED. All values are injected via environment variables
# the operator exports before invoking this script — see runbook for retrieval.
# ============================================================================

set -e

# ---------------------------------------------------------------------------
# Step 1 — Validate required env vars
# ---------------------------------------------------------------------------
# These four vars must be exported in the operator's shell. Each one is
# matched to a Wrangler secret on the internjobs-parrot Worker so that the
# Mattermost <-> Parrot OAuth handshake uses the same client_id/secret pair
# on both sides.

missing=0

if [ -z "${MM_OIDC_CLIENT_ID:-}" ]; then
  echo "ERROR: MM_OIDC_CLIENT_ID is not set." >&2
  echo "  Must match the MATTERMOST_OIDC_CLIENT_ID Wrangler secret on internjobs-parrot." >&2
  missing=1
fi

if [ -z "${MM_OIDC_CLIENT_SECRET:-}" ]; then
  echo "ERROR: MM_OIDC_CLIENT_SECRET is not set." >&2
  echo "  Must match the MATTERMOST_OIDC_CLIENT_SECRET Wrangler secret on internjobs-parrot." >&2
  missing=1
fi

if [ -z "${MM_OIDC_REDIRECT_URI:-}" ]; then
  echo "ERROR: MM_OIDC_REDIRECT_URI is not set." >&2
  echo "  Must match MATTERMOST_OIDC_REDIRECT_URI Wrangler secret." >&2
  echo "  Expected: https://chat.internjobs.ai/signup/gitlab/complete" >&2
  missing=1
fi

if [ -z "${MM_SITE_URL:-}" ]; then
  echo "ERROR: MM_SITE_URL is not set." >&2
  echo "  Expected: https://chat.internjobs.ai" >&2
  missing=1
fi

if [ "$missing" -ne 0 ]; then
  echo "" >&2
  echo "Aborting. Export the four MM_* env vars and re-run." >&2
  echo "See apps/parrot/test/25-01-mattermost-sso-runbook.md for retrieval steps." >&2
  exit 1
fi

echo "[ok] All four MM_* env vars are set."
echo ""

# ---------------------------------------------------------------------------
# Step 2 — Apply the seven GitLabSettings config keys via mmctl
# ---------------------------------------------------------------------------
# These are the canonical seven keys Mattermost reads on boot for its
# GitLab OAuth integration. AuthEndpoint, TokenEndpoint, and UserApiEndpoint
# point at workspace.internjobs.ai/oidc/* — the Parrot Worker bridge —
# NOT chat.internjobs.ai. Do not edit the URLs without also editing the
# matching Worker routes in apps/parrot/workers/routes/oidc.ts.

echo "[1/7] Enabling GitLab OAuth integration..."
mmctl config set-custom GitLabSettings.Enable true

echo "[2/7] Setting GitLab client id..."
mmctl config set-custom GitLabSettings.Id "${MM_OIDC_CLIENT_ID}"

echo "[3/7] Setting GitLab client secret..."
mmctl config set-custom GitLabSettings.Secret "${MM_OIDC_CLIENT_SECRET}"

echo "[4/7] Setting auth endpoint -> workspace.internjobs.ai/oidc/authorize..."
mmctl config set-custom GitLabSettings.AuthEndpoint "https://workspace.internjobs.ai/oidc/authorize"

echo "[5/7] Setting token endpoint -> workspace.internjobs.ai/oidc/token..."
mmctl config set-custom GitLabSettings.TokenEndpoint "https://workspace.internjobs.ai/oidc/token"

echo "[6/7] Setting userinfo endpoint -> workspace.internjobs.ai/oidc/userinfo..."
mmctl config set-custom GitLabSettings.UserApiEndpoint "https://workspace.internjobs.ai/oidc/userinfo"

echo "[7/7] Setting site url..."
mmctl config set-custom ServiceSettings.SiteURL "${MM_SITE_URL}"

echo ""
echo "[ok] All 7 mmctl config-set commands applied."

# ---------------------------------------------------------------------------
# Step 3 — Show the applied GitLabSettings config back to the operator
# ---------------------------------------------------------------------------

echo ""
echo "----- Applied GitLabSettings (mmctl config get GitLabSettings) -----"
mmctl config get GitLabSettings
echo "--------------------------------------------------------------------"

# ---------------------------------------------------------------------------
# Step 4 — Reminder: restart Mattermost + manually verify MMSSO-02
# ---------------------------------------------------------------------------

echo ""
echo "============================================================"
echo "NEXT STEPS (manual — this script does NOT do them):"
echo ""
echo "  1. Restart Mattermost so the new config is picked up:"
echo "       fly machine restart --app internjobs-mattermost"
echo ""
echo "  2. Wait ~30 seconds for the instance to come back up."
echo ""
echo "  3. Open https://chat.internjobs.ai and verify the"
echo "     'GitLab' button appears on the sign-in page."
echo ""
echo "  4. Walk the MMSSO-02 verification checklist in:"
echo "       apps/parrot/test/25-01-mattermost-sso-runbook.md"
echo "============================================================"
