# Debug: Chat OIDC iframe renders Workspace dashboard

## Status

RESOLVED in production.

## Symptom

Opening `https://workspace.internjobs.ai/chat` renders the Parrot Workspace dashboard inside the chat iframe instead of Mattermost.

## Evidence

- Browser frame list after signed-in Chat navigation:
  - main frame: `https://workspace.internjobs.ai/chat`
  - iframe: `https://workspace.internjobs.ai/dashboard`
- Iframe `src` attribute remains `https://chat.internjobs.ai/oauth/gitlab/login`.
- Network chain shows the iframe reaches `workspace.internjobs.ai/sign-in?redirect_url=/oidc/authorize?...`, then Clerk redirects the already-signed-in iframe to `/dashboard`.
- The sign-in page inside the iframe successfully calls `GET /api/me` with HTTP 200, so the session cookie is available to same-site frame navigations.
- The live Clerk session JWT contains `sub`/`sid`/issuer fields but no `email`, `primary_email_address`, or `email_address` claim.

## Root Cause

`apps/parrot/workers/routes/oidc.ts::verifyClerkSession()` required an email claim before it would mint an OIDC auth code. Parrot's main auth middleware intentionally supports phone-OTP Clerk sessions with no email claim and keys employees by Clerk `sub`.

So `/oidc/authorize` saw a valid signed-in phone-only Clerk session, rejected it because `email` was missing, redirected to `/sign-in`, and Clerk redirected the already-signed-in iframe to `/dashboard`.

## Fix Direction

Resolve the Mattermost/OIDC email from `WorkspaceDO.getEmployeeByClerkId(sub)` using the employee directory row created by the admin invite flow. Fall back to JWT email claims only for older email-based sessions.

## Follow-up Token Failure

After deploying the identity fix, the browser advanced to `chat.internjobs.ai/signup/gitlab/complete?code=...`, proving `/oidc/authorize` minted an auth code. Mattermost then rendered `Bad response from token request`.

Mattermost logs showed Parrot returned `{"error":"invalid_grant"}` from `/oidc/token`. The token path did an exact `redirect_uri` compare, while `/authorize` already allowed Mattermost's trailing-slash normalization. The follow-up patch normalizes redirect URIs when storing and consuming OIDC auth codes.

## Follow-up Mattermost User Parse Failure

After the token exchange succeeded, Mattermost returned `Could not parse auth data out of gitlab user object`. Mattermost's GitLab adapter expects the `id` field in the GitLab userinfo response to parse as an `int64`, while Parrot was returning a Clerk string id.

The OIDC `/userinfo` response now emits:
- `id`: stable numeric GitLab-style id derived from the Clerk employee id
- `login` and `username`: workspace-email local part
- `email`: workspace employee email
- `avatar_url`: empty string

## Follow-up Fly Origin Escape

After successful SSO, the iframe attempted to navigate directly to `https://internjobs-mattermost.fly.dev/`, which Chrome blocked because the upstream origin is not intended to be embedded directly.

The Mattermost proxy now rewrites upstream Fly URLs to `https://chat.internjobs.ai` in response `Location` headers, CSP headers, and HTML bodies. It handles `https://`, `http://`, protocol-relative, and URL-encoded variants.

## Verification

- `/api/me` resolves the signed-in Ridhi session as `role: "operator"` using the workspace employee directory even though the Clerk session JWT is phone-only.
- `/api/admin/employees` returns HTTP 200 for the signed-in operator session.
- Chat iframe reaches `https://chat.internjobs.ai/` after SSO and Mattermost API calls such as `/api/v4/users/me`, `/api/v4/users/me/teams`, and `/api/v4/preferences/my_preferences` return HTTP 200.
- The latest browser run no longer showed the Parrot dashboard iframe, token error, GitLab user parse error, or blocked direct Fly-origin navigation.

## Native Chat Follow-up

The iframe fallback proved the OIDC chain, but still did not feel like a Google Workspace-style integrated product. The Chat tab now renders a native Parrot chat surface that talks to Mattermost's `/api/v4` through `https://chat.internjobs.ai` with credentials included.

The first native run exposed a separate workspace issue: Ridhi had a Mattermost session but belonged to no Mattermost team, so the API returned an empty teams list. Parrot now calls `/api/chat/ensure-membership` when the native chat detects no teams. That worker route uses the Mattermost bot token to ensure the signed-in employee belongs to the `InternJobs` team and a default channel, then the client retries team/channel loading.

Browser verification after deploy showed the native Chat tab loading the `InternJobs` team, `Town Square`, `Off-Topic`, existing messages, and the composer without mounting a Parrot dashboard iframe.

## Workspace Boundary Follow-up

GSD then caught the deeper architecture problem: the visible native Chat surface could keep showing the last successful team/channel bootstrap while live message polling returned repeated `401` responses from `chat.internjobs.ai/api/v4/channels/:id/posts`.

That proved the remaining split boundary:

- Parrot/Clerk session was valid on `workspace.internjobs.ai`.
- Mattermost's browser cookie was not durable enough for the Workspace chat tab.
- The browser was still depending on Mattermost as a second user-facing session authority.

Architecture decision:

- Parrot owns the user-facing workspace interface and session boundary.
- Mattermost is an internal chat engine, not a separate app surface.
- Agent Inbox/email should follow the same rule: Parrot-native UI and Parrot-authenticated API, with backing services hidden behind the workspace boundary.

Patch:

- `ChatPane` now calls only Parrot `/api/chat/*` endpoints.
- Parrot Worker validates the Clerk workspace session, then uses the Mattermost bot token internally to load teams, channels, users, posts, and send messages.
- The visible `Full chat` escape hatch was removed from the Chat tab so normal workspace navigation no longer exposes Mattermost as a separate product.
- Parrot-authored posts store `parrot_author_*` props so the native UI can display the Workspace actor instead of leaking the bot account as the author.

Verification before push:

- `npm run build` in `apps/parrot` passed.
- Deployed Parrot Worker version `1b94cfeb-33c9-467b-b16d-8bc78b04876c`.
- GSD reload of `https://workspace.internjobs.ai/chat` rendered native Chat with `Off-Topic`, `Town Square`, existing messages, and the composer.
- Fresh network buffer after reload showed `200` responses for `workspace.internjobs.ai/api/chat/bootstrap` and `workspace.internjobs.ai/api/chat/channels/:id/posts`.
- Fresh network buffer after reload showed no direct browser `chat.internjobs.ai/api/v4/*` calls, which confirms the normal Chat tab is now inside the Parrot session boundary.
