# Mattermost OIDC SSO Activation Runbook (Phase 25-01)

**Purpose:** Activate the Parrot Worker's OIDC bridge as the SSO provider for `chat.internjobs.ai` (Mattermost) by configuring Mattermost via `mmctl`.

**Status:** CODE_COMPLETE — deferred to operator window. See [Deferral status](#deferral-status) at the bottom.

**Closes:** MMSSO-01 (mmctl config). MMSSO-03 (auto-provisioning) is native Mattermost behavior — no code change required (see [Auto-provisioning note](#auto-provisioning-note-mmsso-03)). MMSSO-02 (<5s live SSO round-trip) is verified post-run via the checklist below.

**Code reference:** `apps/parrot/workers/routes/oidc.ts` (already live since v1.2 Phase 10 Wave 2b — no edits needed).

---

## Secret inventory

The script needs four environment variables exported in the operator's shell. None of them are stored in this repo — all four are already provisioned in Wrangler secrets on the `internjobs-parrot` Worker.

| Env var to set         | What it is                                | Where to get it                                                                                                            |
| ---------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `MM_OIDC_CLIENT_ID`     | Value of `MATTERMOST_OIDC_CLIENT_ID`      | `wrangler secret list --name internjobs-parrot` then `wrangler secret get MATTERMOST_OIDC_CLIENT_ID`                          |
| `MM_OIDC_CLIENT_SECRET` | Value of `MATTERMOST_OIDC_CLIENT_SECRET`  | Same — retrieve from Wrangler CLI or Infisical (whichever the team uses as primary)                                          |
| `MM_OIDC_REDIRECT_URI`  | Mattermost callback URL                   | Should be `https://chat.internjobs.ai/signup/gitlab/complete` (matches the value of `MATTERMOST_OIDC_REDIRECT_URI` Wrangler secret) |
| `MM_SITE_URL`           | Public Mattermost URL                     | `https://chat.internjobs.ai`                                                                                              |

> **Note:** Retrieve via **Wrangler CLI**, not the Cloudflare dashboard — the dashboard masks secret values. If you discover these secrets are missing from Wrangler, generate a fresh `client_id`/`client_secret` pair (any random 32+ byte hex string) and set them in Wrangler first:
>
> ```bash
> wrangler secret put MATTERMOST_OIDC_CLIENT_ID --name internjobs-parrot
> wrangler secret put MATTERMOST_OIDC_CLIENT_SECRET --name internjobs-parrot
> ```
>
> Then proceed to [Execution](#execution) with the new values.

---

## Pre-flight checks

Run both before invoking the mmctl script. If either fails, fix it before proceeding — running the script in a degraded state will leave Mattermost half-configured.

1. **OIDC endpoints are live on workspace.internjobs.ai:**

   ```bash
   curl -s https://workspace.internjobs.ai/oidc/.well-known/openid-configuration | jq .
   ```

   Expect JSON containing `issuer`, `authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`, and `jwks_uri`. If you get HTML/404, the Worker is not deployed correctly — fix that first.

2. **mmctl is authenticated against chat.internjobs.ai:**

   ```bash
   mmctl auth list
   ```

   Should show an entry like `chat.internjobs.ai (active)`. If empty or pointing at the wrong server, run `mmctl auth login https://chat.internjobs.ai --name internjobs --username <admin-user>` and complete the prompt.

---

## Execution

Run this from the repo root after exporting the four env vars:

```bash
export MM_OIDC_CLIENT_ID="<value from Wrangler>"
export MM_OIDC_CLIENT_SECRET="<value from Wrangler>"
export MM_OIDC_REDIRECT_URI="https://chat.internjobs.ai/signup/gitlab/complete"
export MM_SITE_URL="https://chat.internjobs.ai"

bash apps/parrot/test/25-01-mmctl-commands.sh
```

The script will:

1. Validate all four env vars are present (exits 1 with a hint if any are empty).
2. Apply the 7 `mmctl config set-custom` commands (3 GitLab credentials + 3 GitLab endpoints + 1 site URL).
3. Print the resulting `GitLabSettings` back via `mmctl config get`.
4. Remind you to do the Fly restart (next section).

Total runtime: ~5–10 seconds (network-bound on mmctl round-trips to chat.internjobs.ai).

---

## Post-run: Mattermost restart

mmctl writes config but Mattermost only reads it on boot. Trigger a restart on Fly:

```bash
fly machine restart --app internjobs-mattermost
```

Wait ~30 seconds, then probe:

```bash
curl -sI https://chat.internjobs.ai | head -1
```

Expect `HTTP/2 200` (or `301` to the login page). If you get `502`/`503`, wait another 30 seconds — Mattermost cold-boot can take up to 90s on the smaller Fly machine sizes.

---

## Verification checklist (MMSSO-02)

Run through these in a fresh incognito window. The full round-trip is the MMSSO-02 closing gate.

- [ ] `https://chat.internjobs.ai` shows a login page with a **"GitLab"** button (the Mattermost UI uses the GitLab label regardless of the upstream provider — this is normal).
- [ ] Clicking **"GitLab"** redirects the browser to `https://workspace.internjobs.ai/oidc/authorize?client_id=…&redirect_uri=…&state=…`.
- [ ] `/oidc/authorize` redirects to `https://workspace.internjobs.ai/sign-in` if the operator is not already signed into Workspace.
- [ ] After completing phone-OTP at workspace.internjobs.ai, the browser is redirected back through `/oidc/authorize` -> `/oidc/token` -> `https://chat.internjobs.ai/signup/gitlab/complete`.
- [ ] **Total wall-clock from "GitLab" click to Mattermost dashboard render < 5 seconds** (excluding the operator-typed OTP step). Measure with the browser dev-tools Network tab.
- [ ] For a **new invite** (an employee who has never logged into Mattermost): after completing OIDC sign-in, Mattermost auto-creates a user account populated with `name` and the workspace email from `/oidc/userinfo`. **This closes MMSSO-03.**

---

## Auto-provisioning note (MMSSO-03)

**No code change is needed for first-login Mattermost user auto-provisioning.**

The `/oidc/userinfo` endpoint (already shipped in v1.2 Phase 10 Wave 2b — see `apps/parrot/workers/routes/oidc.ts`) returns this payload on every authenticated GET:

```json
{
  "sub": "<stable user id>",
  "email": "<workspace email>",
  "email_verified": true,
  "name": "<display name>",
  "given_name": "<first>",
  "family_name": "<last>",
  "preferred_username": "<handle>",
  "username": "<handle>",
  "login": "<handle>",
  "id": "<stable user id>"
}
```

Mattermost's GitLab OAuth module reads `email`, `username`, `name`, and `id` from this payload and creates a new MM user account on the fly when `email` does not match an existing account. This is **native Mattermost behavior** — no Parrot code change, no Mattermost plugin, no migration script.

Verification of this behavior happens organically during the MMSSO-02 checklist above — the last checkbox (new-invite first-login) is the auto-provisioning gate. If the new user successfully lands on the Mattermost dashboard with their workspace email visible in their profile, MMSSO-03 is closed.

---

## Deferral status

**Status:** `CODE_COMPLETE — deferred to operator window.`

**Blocker for live execution:** mmctl requires shell access authenticated against the chat.internjobs.ai system_admin account, plus Fly deploy permission to restart the `internjobs-mattermost` app. Neither credential is available to the autonomous executor — both must come from an operator session.

**When to execute:** Schedule a ~30-minute operator window with:

1. A workstation that has `mmctl` installed and authenticated.
2. `wrangler` CLI logged in to the Cloudflare account that owns `internjobs-parrot`.
3. `fly` CLI logged in with deploy permission for `internjobs-mattermost`.

**Evidence files (this plan):**

- `apps/parrot/test/25-01-mattermost-sso-runbook.md` (this file) — operator-facing runbook
- `apps/parrot/test/25-01-mmctl-commands.sh` — copy-paste shell script

After the operator window closes:

1. Tick the MMSSO-02 checklist boxes above (PR comment or follow-up doc).
2. Update `.planning/workstreams/team-workspace/STATE.md` "Open Items" section to mark MMSSO-02 verified.
3. Phase 25 Wave 1 then sits cleanly at: 25-01 closed, 25-02 closed, 25-03 closed -> Phase 25 ready for verifier review.
