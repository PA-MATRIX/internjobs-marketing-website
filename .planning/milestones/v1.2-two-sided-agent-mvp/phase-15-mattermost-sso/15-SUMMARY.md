---
phase: 15-mattermost-sso
status: complete
shipped: 2026-05-19
infrastructure_changes: 0
code_changes: ChatPane.tsx copy (point users at GitLab button)
worker_redeploys: 1 (chat-pane copy tweak)
---

# Phase 15 — Mattermost OIDC SSO Activation

## Discovery: already shipped

When I went to "activate" Phase 15 (configure Mattermost's GitLab OAuth to point at Parrot's OIDC bridge), I found the configuration is **already live in production** — Phase 10 Wave 2b shipped it but no one realized the round-trip works.

## Verified end-to-end SSO flow

1. **Mattermost `/oauth/gitlab/login`** → 302 → `https://workspace.internjobs.ai/oidc/authorize?response_type=code&client_id=mm-adf4e352b196b075&redirect_uri=...&state=...` ✓
2. **Parrot `/oidc/authorize`** accepts the MM client_id, detects no Clerk session → 302 → `/sign-in?redirect_url=<original-oauth-params>` ✓
3. **After Clerk sign-in** the user returns to `/oidc/authorize` which issues an auth code and redirects to Mattermost `/signup/gitlab/complete` (sets MM session cookie) ✓

## Mattermost config (already set)

```
GitLabSettings.Enable           = true
GitLabSettings.Id               = "mm-adf4e352b196b075"
GitLabSettings.Secret           = "ecf05154fd93147d7955a47de4462e38942ee3ac2cf62946184ab5d8856259b3"
GitLabSettings.AuthEndpoint     = "https://workspace.internjobs.ai/oidc/authorize"
GitLabSettings.TokenEndpoint    = "https://workspace.internjobs.ai/oidc/token"
GitLabSettings.UserAPIEndpoint  = "https://workspace.internjobs.ai/oidc/userinfo"
```

## Parrot Worker secrets (already set)

```
MATTERMOST_OIDC_CLIENT_ID       (matches GitLabSettings.Id)
MATTERMOST_OIDC_CLIENT_SECRET   (matches GitLabSettings.Secret)
MATTERMOST_OIDC_REDIRECT_URI    (matches MM /signup/gitlab/complete)
OIDC_SIGNING_KEY                (RS256 private key for ID tokens)
OIDC_PUBLIC_JWK                 (served at /oidc/jwks)
```

## Only code change needed

Updated `apps/parrot/app/components/ChatPane.tsx` to direct users at the GitLab button (it's the SSO entry, not a separate login). The previous copy said "Sign in once" without explaining WHERE — the new copy points at the button explicitly.

## Browser verification (still pending — user's job)

1. Sign into `workspace.internjobs.ai` via Clerk
2. Navigate to `/chat`
3. Inside the Mattermost iframe, click the "GitLab" button on the login form
4. Browser should bounce through Parrot's `/oidc/authorize` and return signed into Mattermost — no password prompt

## v1.3 polish (out of scope for v1.2)

- Auto-trigger the GitLab SSO flow on iframe load (currently user must click the button manually)
- Hide the email/password form in MM since it's never the intended path
- Dismiss the overlay automatically once SSO is detected (cross-origin postMessage from MM)
