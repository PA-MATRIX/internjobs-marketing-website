# Phase 21: Credential Rotation — Runbook

**Milestone:** v1.3 Pilot Hardening
**Phase:** 21 of 21 — Pure ops, no production code changes
**Purpose:** Rotate 5 token families used heavily during v1.2 development; revoke old tokens; confirm all `/healthz` endpoints green. The final green-board is the v1.3 ship signal.
**Executor:** User only — Claude cannot interact with Clerk dashboards, Cloudflare dashboards, or run `fly secrets set` against production.

---

## Reference: Service Map

| Service | Fly App / Worker Name | Public URL | Healthz URL |
|---------|----------------------|------------|-------------|
| Student app | `internjobs-ai-student-app` (org: `internjobs-sios-org`) | `https://app.internjobs.ai` | `https://app.internjobs.ai/healthz` |
| Parrot Worker | `internjobs-parrot` | `https://workspace.internjobs.ai` | `https://workspace.internjobs.ai/healthz` |
| Graph proxy | `internjobs-graph-api` (added in Phase 18) | `https://internjobs-graph-api.fly.dev` | `https://internjobs-graph-api.fly.dev/healthz` |
| Agentic inbox | `internjobs-agentic-inbox` Worker | `https://agent.internjobs.ai` | `https://agent.internjobs.ai/healthz` |

**Infisical reference:**
- Project ID: `26995afd-9a6f-4690-912f-01cbcebb76d5`
- Org ID: `2c12f042-e98f-4fb3-8b40-16aec29f9b91`
- Environment: `prod`
- Path: `/internjobs-ai`

**Clerk app IDs:**
- Student app (`Internjobs.ai`): `app_38BrRDRKnvbo7vlE2ZZtMc7hFPC` — dashboard at `https://dashboard.clerk.com/apps/app_38BrRDRKnvbo7vlE2ZZtMc7hFPC`
- Workspace/employee app: separate Clerk app — dashboard at `https://dashboard.clerk.com` (find the "InternJobs Employees" / `workspace.internjobs.ai` app)

---

## CRITICAL PITFALLS — Read Before You Touch Anything

**1. Cloudflare has NO grace period on revoked tokens.**
A revoked CF token causes immediate 401s for all in-flight requests. You MUST verify the new token is live and `/healthz` is green BEFORE revoking the old one. There is no undo once revoked.

**2. The `CLOUDFLARE_AI_API_TOKEN` is shared between two services.**
Both the Fly student app (`internjobs-ai-student-app`) and the Parrot Worker (`internjobs-parrot`) use the same Workers AI token. You must update and verify BOTH before revoking the old token. Order: Fly first → verify → Worker → verify → THEN revoke.

**3. Clerk multi-key overlap enables zero-downtime rotation.**
Clerk supports multiple active Secret Keys on the same app simultaneously. The procedure is: create new → deploy with new → verify → delete old. DO NOT delete the old key before the new one is live and verified.

**4. NEVER rotate Clerk JWT Signing Keys.**
Rotating a JWT Signing Key signs out every active user across both Clerk apps immediately — phone-OTP employees must re-authenticate. This is the nuclear option. Rotate Secret Keys only.

**5. The broad CF API token is a chicken-and-egg bootstrap.**
Wrangler does NOT auto-pull credentials from Infisical. The broad CF token must be set in your LOCAL shell environment BEFORE running any wrangler command. Write to Infisical second, after your local shell is updated.

**6. `wrangler deploy --dry-run` is broken.**
The `virtual:react-router/server-build` error in the parrot workspace makes `--dry-run` fail. Do not use it as a sanity check. Use `wrangler secret put <KEY>` and then check `/healthz` instead.

---

## Pre-Flight Checklist

Work through this list top to bottom before touching any token. Do NOT start rotation until all items are checked.

- [ ] **Phases 18, 19, and 20 are verified complete.** All three `/healthz` endpoints (student app, Parrot Worker, graph-api) return green for the fields introduced by those phases (`graph_ready`, `graph_proxy_reachable`, `lakera_ready`). If any phase is not yet complete, stop — Phase 21 must run last.

- [ ] **Low-traffic window.** It is outside peak usage hours (nights/weekends preferred). If Ridhi or any startup pilot is actively using the workspace, defer.

- [ ] **Infisical CLI is authenticated.**
  ```bash
  infisical login
  infisical whoami
  ```
  Expected output: shows your email address. If not, run `infisical login` and complete the browser auth flow.

- [ ] **Fly CLI is authenticated.**
  ```bash
  fly auth whoami
  ```
  Expected output: your Fly email. If not, run `fly auth login`.

- [ ] **Wrangler is authenticated.**
  ```bash
  npx wrangler whoami
  ```
  Expected output: your Cloudflare email and account name. If not, run `npx wrangler login`.

- [ ] **All four browser tabs open and signed in:**
  - Tab A: Clerk student app dashboard → `https://dashboard.clerk.com/apps/app_38BrRDRKnvbo7vlE2ZZtMc7hFPC/api-keys`
  - Tab B: Clerk workspace/employee app dashboard → `https://dashboard.clerk.com` → select "InternJobs Employees" app → API Keys
  - Tab C: Cloudflare dashboard → `https://dash.cloudflare.com/profile/api-tokens`
  - Tab D: Infisical project secrets → `https://app.infisical.com` → project `26995afd...` → prod → `/internjobs-ai`

- [ ] **Baseline `/healthz` recorded.**
  Run all four healthz curls now and save the output. This is your rollback baseline.
  ```bash
  curl -s https://app.internjobs.ai/healthz | jq .
  curl -s https://workspace.internjobs.ai/healthz | jq .
  curl -s https://internjobs-graph-api.fly.dev/healthz | jq .
  curl -s https://agent.internjobs.ai/healthz | jq .
  ```

- [ ] **Terminal session variable.** Decide now where your broad CF API token will live during this session. You will update the value mid-runbook:
  ```bash
  export CLOUDFLARE_API_TOKEN="<your current broad token>"  # set from your current creds
  ```

---

## Section 1: Clerk Student App Secret Key

**Token family:** `CLERK_SECRET_KEY`
**Consumer:** `internjobs-ai-student-app` Fly app (`apps/app/src/auth.mjs` calls `createClerkClient({ secretKey: config.clerk.secretKey, ... })`)
**Env var name in Fly:** `CLERK_SECRET_KEY`
**Risk level:** LOW — Clerk multi-key overlap means both old and new keys are valid simultaneously during the overlap window. No user sessions are affected.

### Step 1.1 — Generate new key in Clerk dashboard

1. Open Tab A: `https://dashboard.clerk.com/apps/app_38BrRDRKnvbo7vlE2ZZtMc7hFPC/api-keys`
2. Click **"Add key"** (or "Rotate API keys" → "Generate new key" depending on current Clerk UI).
3. Copy the new key — it starts with `sk_live_`. Keep this value handy for the next steps.
4. Do NOT delete or revoke the old key yet. Both keys are now active.

### Step 1.2 — Write new key to Infisical

```bash
infisical secrets set CLERK_SECRET_KEY="sk_live_NEWVALUE" \
  --projectId 26995afd-9a6f-4690-912f-01cbcebb76d5 \
  --env prod \
  --path /internjobs-ai
```

Verify it landed:
```bash
infisical secrets get CLERK_SECRET_KEY \
  --projectId 26995afd-9a6f-4690-912f-01cbcebb76d5 \
  --env prod \
  --path /internjobs-ai
```
Expected: shows the new `sk_live_...` value you just set.

### Step 1.3 — Deploy new key to Fly app

```bash
fly secrets set CLERK_SECRET_KEY="sk_live_NEWVALUE" \
  --app internjobs-ai-student-app
```

Fly will roll the app automatically after secret update. Wait for the restart to complete:
```bash
fly status --app internjobs-ai-student-app
```
Wait until all machines show `started`.

### Step 1.4 — Verify

```bash
curl -s https://app.internjobs.ai/healthz | jq .
```

Expected: `"clerk": true` (and all other fields still green). If `"clerk": false`, see Rollback below before proceeding.

Also verify the JWKS endpoint is still resolving (this should be unaffected by Secret Key rotation, but confirm):
```bash
curl -s https://clerk.internjobs.ai/.well-known/jwks.json | jq .keys[0].kid
```
Expected: returns a key ID string. If you get a network error or empty `keys` array, something is wrong — stop and investigate before continuing.

### Step 1.5 — Rollback if verify fails

1. `infisical secrets set CLERK_SECRET_KEY="sk_live_OLDVALUE" --projectId 26995afd-9a6f-4690-912f-01cbcebb76d5 --env prod --path /internjobs-ai`
2. `fly secrets set CLERK_SECRET_KEY="sk_live_OLDVALUE" --app internjobs-ai-student-app`
3. Verify healthz is green again.
4. Do NOT delete the new key from Clerk yet — leave both active and investigate why the new key failed before retrying.

### Step 1.6 — Revoke old key (only after verify passes)

1. Return to Tab A: `https://dashboard.clerk.com/apps/app_38BrRDRKnvbo7vlE2ZZtMc7hFPC/api-keys`
2. Find the OLD `sk_live_...` key (not the one you just generated).
3. Click **Delete** or **Revoke**.
4. Confirm revocation.

### Step 1.7 — Commit checkpoint

```bash
git add -A
git commit -m "ops(phase-21): rotate CLERK_SECRET_KEY (student app) → verified green"
```

---

## Section 2: Clerk Workspace App Secret Key

**Token family:** `PARROT_CLERK_SECRET_KEY`
**Consumer:** `internjobs-parrot` Cloudflare Worker (used for JWT verification and Clerk Backend API calls in `workers/lib/clerk-admin.ts` and invite flow)
**Env var name in Worker:** `PARROT_CLERK_SECRET_KEY`
**Risk level:** LOW — Same Clerk multi-key overlap procedure. Rotating `PARROT_CLERK_SECRET_KEY` does NOT affect existing employee sessions (sessions are validated against JWKS, not the secret key directly).

### Step 2.1 — Generate new key in Clerk dashboard

1. Open Tab B: Clerk dashboard → select the "InternJobs Employees" app (workspace.internjobs.ai).
2. Navigate to **API Keys**.
3. Click **"Add key"** (or "Generate new key").
4. Copy the new key — it starts with `sk_live_`. Keep it for the next steps.
5. Do NOT delete or revoke the old key yet.

### Step 2.2 — Write new key to Infisical

```bash
infisical secrets set PARROT_CLERK_SECRET_KEY="sk_live_NEWVALUE" \
  --projectId 26995afd-9a6f-4690-912f-01cbcebb76d5 \
  --env prod \
  --path /internjobs-ai
```

Verify:
```bash
infisical secrets get PARROT_CLERK_SECRET_KEY \
  --projectId 26995afd-9a6f-4690-912f-01cbcebb76d5 \
  --env prod \
  --path /internjobs-ai
```

### Step 2.3 — Deploy new key to Parrot Worker

```bash
cd /Users/rajren/internjobs-cms/apps/parrot
npx wrangler secret put PARROT_CLERK_SECRET_KEY
```

Wrangler will prompt: paste the new `sk_live_...` value and press Enter. The secret propagates to the Worker's next cold start (typically within seconds to minutes under normal load).

To force an immediate reload, redeploy the Worker:
```bash
npm run deploy
```
(Or `npx wrangler deploy` from `apps/parrot`.)

### Step 2.4 — Verify

```bash
curl -s https://workspace.internjobs.ai/healthz | jq .
```

Expected: all health fields green. Check specifically for any Clerk-related fields (may be named `clerkReady`, `clerk_auth`, or similar depending on what Phase 18/19/20 added to the Worker's healthz).

Also verify the workspace JWKS endpoint resolves:
```bash
curl -s https://clerk.workspace.internjobs.ai/.well-known/jwks.json | jq .keys[0].kid
```
Expected: returns a key ID string.

### Step 2.5 — Rollback if verify fails

1. `infisical secrets set PARROT_CLERK_SECRET_KEY="sk_live_OLDVALUE" --projectId 26995afd-9a6f-4690-912f-01cbcebb76d5 --env prod --path /internjobs-ai`
2. `cd /Users/rajren/internjobs-cms/apps/parrot && npx wrangler secret put PARROT_CLERK_SECRET_KEY` (paste old value)
3. Redeploy: `npm run deploy`
4. Verify healthz green again before investigating.

### Step 2.6 — Revoke old key (only after verify passes)

1. Return to Tab B: workspace Clerk app → API Keys.
2. Find the OLD `sk_live_...` key.
3. Click **Delete** or **Revoke**. Confirm.

### Step 2.7 — Commit checkpoint

```bash
git add -A
git commit -m "ops(phase-21): rotate PARROT_CLERK_SECRET_KEY (workspace app) → verified green"
```

---

## Section 3: Cloudflare Email API Token

**Token family:** `CLOUDFLARE_EMAIL_API_TOKEN` (and/or `CLOUDFLARE_EMAIL_ROUTING_API_TOKEN`)
**Consumer:** `internjobs-parrot` Worker (`workers/lib/email.ts` for outbound via CF Email Service; `workers/lib/*` for per-employee Email Routing rule provisioning at invite time)
**Risk level:** MEDIUM — Routing the wrong token's revocation could break admin invite welcome emails.

### Step 3.0 — MANDATORY AUDIT FIRST: Identify which token is actually live

The Parrot Worker declares **two** email tokens in `types.ts`:
- `CLOUDFLARE_EMAIL_API_TOKEN` — scoped to CF Email Service (`accounts/email:write`) — used for outbound agent email
- `CLOUDFLARE_EMAIL_ROUTING_API_TOKEN` — scoped to CF Email Routing rules (`zones/email:edit`) — used to provision per-employee mailboxes at invite time

You must confirm which one(s) are actually set in the Worker before rotating anything.

Run this to check what's currently set in Infisical:
```bash
infisical secrets get CLOUDFLARE_EMAIL_API_TOKEN \
  --projectId 26995afd-9a6f-4690-912f-01cbcebb76d5 \
  --env prod \
  --path /internjobs-ai

infisical secrets get CLOUDFLARE_EMAIL_ROUTING_API_TOKEN \
  --projectId 26995afd-9a6f-4690-912f-01cbcebb76d5 \
  --env prod \
  --path /internjobs-ai
```

Check which exist (you may see one, both, or neither). Also verify in the Cloudflare dashboard (Tab C → API Tokens) which tokens are currently active and what their scopes are.

**Decision table:**
- If only `CLOUDFLARE_EMAIL_API_TOKEN` exists → rotate that one. Skip `CLOUDFLARE_EMAIL_ROUTING_API_TOKEN` steps.
- If only `CLOUDFLARE_EMAIL_ROUTING_API_TOKEN` exists → rotate that one. Update the section name accordingly.
- If both exist → rotate both, one at a time (rotate + verify the outbound one first, then the routing one).
- If neither exists in Infisical → the token may be set directly in the Worker via `wrangler secret put` without Infisical tracking. Check `wrangler secret list --name internjobs-parrot` to see what secrets the Worker knows about.

The steps below assume `CLOUDFLARE_EMAIL_API_TOKEN` is the live one. Adjust accordingly.

### Step 3.1 — Generate new CF Email API token in Cloudflare dashboard

1. Open Tab C: `https://dash.cloudflare.com/profile/api-tokens`
2. Click **Create Token**.
3. Use a **Custom Token** with the same scopes as the existing email token:
   - **Account → Email Routing → Edit** (for outbound via CF Email Service)
   - **Zone → Email Routing Rules → Edit** (for per-employee routing rules, if this token covers both)
   - Account: `internjobs-sios-org` (or whatever account the existing token is scoped to — match it exactly)
4. Name it something like `internjobs-email-api-v1.3`.
5. Click **Continue to summary → Create Token**.
6. Copy the token value immediately (shown only once).

### Step 3.2 — Write new token to Infisical

```bash
infisical secrets set CLOUDFLARE_EMAIL_API_TOKEN="NEW_CF_EMAIL_TOKEN" \
  --projectId 26995afd-9a6f-4690-912f-01cbcebb76d5 \
  --env prod \
  --path /internjobs-ai
```

### Step 3.3 — Deploy new token to Parrot Worker

```bash
cd /Users/rajren/internjobs-cms/apps/parrot
npx wrangler secret put CLOUDFLARE_EMAIL_API_TOKEN
# paste the new token value when prompted

npm run deploy
```

### Step 3.4 — Verify

```bash
curl -s https://workspace.internjobs.ai/healthz | jq .
```

Expected: all fields green. Then do a functional verification — trigger a test email action if safe to do so (e.g., inspect the last `/ops/drafts` or trigger a no-op to confirm email auth is working). If the Worker healthz shows any email-related failures, do not proceed.

### Step 3.5 — Rollback if verify fails

1. `infisical secrets set CLOUDFLARE_EMAIL_API_TOKEN="OLD_CF_EMAIL_TOKEN" --projectId 26995afd-9a6f-4690-912f-01cbcebb76d5 --env prod --path /internjobs-ai`
2. `cd /Users/rajren/internjobs-cms/apps/parrot && npx wrangler secret put CLOUDFLARE_EMAIL_API_TOKEN` (paste old value)
3. `npm run deploy`
4. Verify healthz green. Then delete the new token from CF dashboard.

### Step 3.6 — Revoke old token (only after verify passes)

1. Return to Tab C: `https://dash.cloudflare.com/profile/api-tokens`
2. Find the OLD email API token (the one you replaced).
3. Click **Edit** → **Roll** → **Revoke** (or the equivalent "Delete" option).

### Step 3.7 — Commit checkpoint

```bash
git add -A
git commit -m "ops(phase-21): rotate CLOUDFLARE_EMAIL_API_TOKEN → verified green"
```

---

## Section 4: Cloudflare AI API Token

**Token family:** `CLOUDFLARE_AI_API_TOKEN`
**Consumers:** TWO services share this token — this is the highest-risk rotation.
  1. `internjobs-ai-student-app` (Fly) — calls `api.cloudflare.com/.../ai/run/...` directly for student SMS LLM turns (Llama 3.3 70B) and embeddings (bge-base-en-v1.5). Token read at startup as `process.env.CLOUDFLARE_AI_API_TOKEN`.
  2. `internjobs-parrot` (CF Worker) — calls CF AI Gateway with this token for kimi-k2.6 Dashboard Mothership todo extraction.
**Risk level:** HIGHEST — if the old token is revoked before both services are on the new one, student SMS agent turns fail silently (no LLM response) and the Parrot Dashboard stops extracting todos.

**Required order: Fly student app FIRST, verify, Worker SECOND, verify, THEN revoke.**

### Step 4.1 — Generate new CF AI API token in Cloudflare dashboard

1. Open Tab C: `https://dash.cloudflare.com/profile/api-tokens`
2. Click **Create Token → Custom Token**.
3. Scopes required (match the existing AI token exactly):
   - **Account → Workers AI → Edit** (or `ai:write`)
   - Account: the same account that hosts the Workers AI resources (check the existing token's scope to confirm)
4. Name it `internjobs-ai-api-v1.3`.
5. Click **Continue to summary → Create Token**.
6. Copy the token value immediately.

### Step 4.2 — Write new token to Infisical

```bash
infisical secrets set CLOUDFLARE_AI_API_TOKEN="NEW_CF_AI_TOKEN" \
  --projectId 26995afd-9a6f-4690-912f-01cbcebb76d5 \
  --env prod \
  --path /internjobs-ai
```

### Step 4.3 — Deploy to Fly student app FIRST

```bash
fly secrets set CLOUDFLARE_AI_API_TOKEN="NEW_CF_AI_TOKEN" \
  --app internjobs-ai-student-app
```

Wait for the Fly app to restart:
```bash
fly status --app internjobs-ai-student-app
```
Wait until all machines show `started`.

### Step 4.4 — Verify student app on new token

```bash
curl -s https://app.internjobs.ai/healthz | jq .
```

Expected: `"workersAiReady": true` (or whatever the current healthz key is for Workers AI in the student app). If this is false, the new token does not have the right scopes — do NOT continue to the Worker. See Rollback (4.7).

**Optional but recommended:** Send a test SMS from your personal phone to the Spectrum number and confirm the agent replies. This is the only true end-to-end proof that the AI token is working.

### Step 4.5 — Deploy to Parrot Worker SECOND

Only proceed here after Step 4.4 passes.

```bash
cd /Users/rajren/internjobs-cms/apps/parrot
npx wrangler secret put CLOUDFLARE_AI_API_TOKEN
# paste the new token value when prompted

npm run deploy
```

### Step 4.6 — Verify Parrot Worker on new token

```bash
curl -s https://workspace.internjobs.ai/healthz | jq .
```

Expected: all fields green, including any AI gateway health keys (`ai_gateway_reachable` or similar). If the Worker shows any AI-related failures, see Rollback (4.7) — do NOT revoke the old token.

### Step 4.7 — Rollback if either verify fails

**Fly rollback:**
1. `fly secrets set CLOUDFLARE_AI_API_TOKEN="OLD_CF_AI_TOKEN" --app internjobs-ai-student-app`
2. Verify `workersAiReady: true` in student app healthz.

**Worker rollback:**
1. `cd /Users/rajren/internjobs-cms/apps/parrot && npx wrangler secret put CLOUDFLARE_AI_API_TOKEN` (paste old value)
2. `npm run deploy`
3. Verify healthz green.

**In both cases:** Do NOT revoke the old CF AI token. The old token remains valid and services recover immediately on redeploy. Investigate the scope mismatch on the new token before retrying.

### Step 4.8 — Revoke old token (ONLY after BOTH Fly and Worker verify pass)

This is a one-way door. Only proceed if both Step 4.4 AND Step 4.6 returned green.

1. Return to Tab C: `https://dash.cloudflare.com/profile/api-tokens`
2. Find the OLD Workers AI token (the one you replaced).
3. Click **Edit** → **Revoke** (or equivalent Delete option).
4. The old token is now invalid. Any service still using it will get 401s.

### Step 4.9 — Commit checkpoint

```bash
git add -A
git commit -m "ops(phase-21): rotate CLOUDFLARE_AI_API_TOKEN → Fly + Worker verified green, old token revoked"
```

---

## Section 5: GRAPH_API_SECRET

**Token family:** `GRAPH_API_SECRET`
**Consumers:** `internjobs-parrot` Worker (Bearer token in `Authorization` header on every `POST /query` to the graph proxy) + `internjobs-graph-api` Fly app (validates incoming Bearer token)
**Context:** This secret was introduced in Phase 18. It is a shared secret between the Parrot Worker and the graph proxy — rotate both consumers atomically.
**Risk level:** MEDIUM — if the secret is rotated on one side but not the other, graph reads and writes fail (Worker gets 401 from proxy). The student app's `graph.mjs` is NOT affected (it talks to FalkorDB directly, not via the proxy).

### Step 5.1 — Generate a new shared secret

```bash
openssl rand -hex 32
```

Copy the output (a 64-character hex string). This is your new `GRAPH_API_SECRET`.

### Step 5.2 — Write new secret to Infisical

```bash
infisical secrets set GRAPH_API_SECRET="NEW_GRAPH_SECRET" \
  --projectId 26995afd-9a6f-4690-912f-01cbcebb76d5 \
  --env prod \
  --path /internjobs-ai
```

### Step 5.3 — Deploy to both consumers in the same deploy window

Deploy both the graph proxy and the Parrot Worker with the new secret before verifying. Both must be on the new secret simultaneously — deploying only one side will break the connection.

**Graph proxy (Fly):**
```bash
fly secrets set GRAPH_API_SECRET="NEW_GRAPH_SECRET" \
  --app internjobs-graph-api
```
Wait for restart:
```bash
fly status --app internjobs-graph-api
```

**Parrot Worker:**
```bash
cd /Users/rajren/internjobs-cms/apps/parrot
npx wrangler secret put GRAPH_API_SECRET
# paste new secret when prompted

npm run deploy
```

### Step 5.4 — Verify

```bash
curl -s https://workspace.internjobs.ai/healthz | jq .
```

Expected: `graph_ready: true` and `graph_proxy_reachable: true` (both fields introduced in Phase 18). If either is false, the secret mismatch is the likely cause.

```bash
curl -s https://internjobs-graph-api.fly.dev/healthz | jq .
```

Expected: `{"ok": true}` (or similar shape from Phase 18's health endpoint).

### Step 5.5 — Rollback if verify fails

1. `infisical secrets set GRAPH_API_SECRET="OLD_GRAPH_SECRET" --projectId 26995afd-9a6f-4690-912f-01cbcebb76d5 --env prod --path /internjobs-ai`
2. `fly secrets set GRAPH_API_SECRET="OLD_GRAPH_SECRET" --app internjobs-graph-api`
3. `cd /Users/rajren/internjobs-cms/apps/parrot && npx wrangler secret put GRAPH_API_SECRET` (paste old value), then `npm run deploy`
4. Verify healthz green on both Worker and graph-api.

Note: unlike Cloudflare API tokens, there is no "revoke" step for this secret — it is managed entirely by you. Once you write the new value to both services and Infisical, the old value is simply no longer in use.

### Step 5.6 — Commit checkpoint

```bash
git add -A
git commit -m "ops(phase-21): rotate GRAPH_API_SECRET → Worker + graph-api verified green"
```

---

## Section 6: LAKERA_GUARD_API_KEY

**Token family:** `LAKERA_GUARD_API_KEY`
**Consumers:** `internjobs-ai-student-app` Fly app (`apps/app/src/safety/screen.mjs`) + `internjobs-parrot` Worker (`workers/lib/safety.ts`)
**Context:** Introduced in Phase 20. Now that it is tracked in Infisical, rotate it to establish a clean post-v1.2 baseline.
**Risk level:** LOW — both consumers are fail-open on Lakera errors. If the new key is wrong, screening is skipped with a `passed_lakera_unavailable` log entry; student communication is not blocked.

### Step 6.1 — Generate a new Lakera API key

1. Go to `https://platform.lakera.ai` and sign in.
2. Navigate to **API Keys** (or Settings → API Keys — location varies by Lakera/Cisco AI Defense UI).
3. Click **Create new key** (or "Generate").
4. Copy the new key value.
5. Do NOT revoke the old key yet.

### Step 6.2 — Write new key to Infisical

```bash
infisical secrets set LAKERA_GUARD_API_KEY="NEW_LAKERA_KEY" \
  --projectId 26995afd-9a6f-4690-912f-01cbcebb76d5 \
  --env prod \
  --path /internjobs-ai
```

### Step 6.3 — Deploy to both consumers

**Fly student app:**
```bash
fly secrets set LAKERA_GUARD_API_KEY="NEW_LAKERA_KEY" \
  --app internjobs-ai-student-app
```

**Parrot Worker:**
```bash
cd /Users/rajren/internjobs-cms/apps/parrot
npx wrangler secret put LAKERA_GUARD_API_KEY
# paste new key when prompted

npm run deploy
```

### Step 6.4 — Verify

```bash
curl -s https://app.internjobs.ai/healthz | jq .
curl -s https://workspace.internjobs.ai/healthz | jq .
```

Both should be fully green. If Phase 20 added a `lakera_ready` field to either healthz, confirm it is `true`.

Functional check: send a test inbound SMS with a benign message and confirm the agent replies normally. Check `/ops/safety` — there should be no unexpected flag entries from the test message.

### Step 6.5 — Rollback if verify fails

Because both consumers are fail-open, a wrong Lakera key degrades gracefully (screening is skipped). If you see `lakera_ready: false` or unexpected behavior:

1. `infisical secrets set LAKERA_GUARD_API_KEY="OLD_LAKERA_KEY" --projectId 26995afd-9a6f-4690-912f-01cbcebb76d5 --env prod --path /internjobs-ai`
2. `fly secrets set LAKERA_GUARD_API_KEY="OLD_LAKERA_KEY" --app internjobs-ai-student-app`
3. `cd /Users/rajren/internjobs-cms/apps/parrot && npx wrangler secret put LAKERA_GUARD_API_KEY` (paste old value), then `npm run deploy`

### Step 6.6 — Revoke old key (only after verify passes)

Return to `https://platform.lakera.ai` → API Keys → revoke / delete the old key.

### Step 6.7 — Commit checkpoint

```bash
git add -A
git commit -m "ops(phase-21): rotate LAKERA_GUARD_API_KEY → Fly + Worker verified green"
```

---

## Section 7: Broad-Scope Cloudflare API Token

**Token family:** Broad CF API token (used by `wrangler` CLI and `flyctl` for deployments)
**Consumer:** Your local shell / CI — this is a DEVELOPER CREDENTIAL, not a runtime Worker secret. No Fly app or Worker holds this token at runtime.
**Risk level:** MEDIUM — if you revoke the old token before updating your local shell, you lose the ability to deploy Workers or run `fly` operations for emergency fixes.

**THIS IS THE LAST STEP.** Rotating the broad token after everything else is verified means that any rollback needed in Sections 1-6 can still be executed with the current token.

### Step 7.1 — Generate new broad CF API token in Cloudflare dashboard

1. Open Tab C: `https://dash.cloudflare.com/profile/api-tokens`
2. Click **Create Token → Custom Token** (or edit an existing template).
3. Match the scopes of the existing broad token exactly. Based on the current Parrot setup, the broad token needs at minimum:
   - **Workers Scripts → Edit** (for `wrangler deploy`)
   - **R2 Storage → Edit** (for R2 bucket operations)
   - **Account → Cloudflare Workers KV Storage → Edit** (for KV namespace operations)
   - **Zone → Email Routing Rules → Edit** (for email routing provisioning)
   - **Account → Cloudflare Pages → Edit** (if used for marketing site deploys)
   - Check the existing token's scopes in the CF dashboard before creating — replicate exactly.
4. Name it `internjobs-dev-cli-v1.3`.
5. Click **Continue to summary → Create Token**.
6. Copy the token value immediately.

### Step 7.2 — Update your LOCAL shell environment FIRST

This is the chicken-and-egg constraint. Wrangler reads `CLOUDFLARE_API_TOKEN` from the environment at invocation time — it does NOT pull from Infisical.

```bash
export CLOUDFLARE_API_TOKEN="NEW_BROAD_CF_TOKEN"
```

Confirm wrangler sees the new token:
```bash
npx wrangler whoami
```
Expected: your Cloudflare email and account name. If this fails, the new token has wrong scopes or is not yet propagated — do NOT revoke the old one.

### Step 7.3 — Run a wrangler deploy to confirm the token works end-to-end

```bash
cd /Users/rajren/internjobs-cms/apps/parrot
npm run deploy
```

This deploys the Parrot Worker using the new broad token. If the deploy succeeds, the token has the required Workers Scripts scope.

Verify the Worker is still healthy after the deploy:
```bash
curl -s https://workspace.internjobs.ai/healthz | jq .
```
Expected: all fields green.

### Step 7.4 — Write new token to Infisical

After local shell is confirmed working (Step 7.2 + 7.3), write to Infisical:

```bash
infisical secrets set CLOUDFLARE_API_TOKEN="NEW_BROAD_CF_TOKEN" \
  --projectId 26995afd-9a6f-4690-912f-01cbcebb76d5 \
  --env prod \
  --path /internjobs-ai
```

Note: the broad CF token is written to Infisical for record-keeping, but it is not injected into any running service. Infisical here is documentation, not deployment automation.

### Step 7.5 — Verify all healthz endpoints one final time

Run the full sweep now, before revoking:
```bash
curl -s https://app.internjobs.ai/healthz | jq .
curl -s https://workspace.internjobs.ai/healthz | jq .
curl -s https://internjobs-graph-api.fly.dev/healthz | jq .
curl -s https://agent.internjobs.ai/healthz | jq .
```
All four must be fully green before proceeding to revoke.

### Step 7.6 — Rollback if anything is broken

1. Run `export CLOUDFLARE_API_TOKEN="OLD_BROAD_CF_TOKEN"` in your shell.
2. Verify `npx wrangler whoami` works with the old token.
3. Do NOT revoke the old token.

### Step 7.7 — Revoke old token (only after all healthz green)

1. Return to Tab C: `https://dash.cloudflare.com/profile/api-tokens`
2. Find the OLD broad-scope token.
3. Click **Edit** → **Revoke** (or Delete).

### Step 7.8 — Commit checkpoint

```bash
git add -A
git commit -m "ops(phase-21): rotate broad CF API token → all healthz green, old token revoked"
```

---

## Post-Rotation Green-Board Check

Run this full sweep immediately after completing all 7 sections. This output is the v1.3 ship signal.

### Healthz sweep — all must be green

```bash
echo "=== STUDENT APP ===" && curl -s https://app.internjobs.ai/healthz | jq .
echo "=== PARROT WORKER ===" && curl -s https://workspace.internjobs.ai/healthz | jq .
echo "=== GRAPH PROXY ===" && curl -s https://internjobs-graph-api.fly.dev/healthz | jq .
echo "=== AGENTIC INBOX ===" && curl -s https://agent.internjobs.ai/healthz | jq .
```

**Expected fields per surface:**

| Field | Surface | Expected value |
|-------|---------|---------------|
| `clerk` | Student app | `true` |
| `workersAiReady` | Student app | `true` |
| `graphReady` | Student app | `true` |
| `graph_ready` | Parrot Worker | `true` |
| `graph_proxy_reachable` | Parrot Worker | `true` |
| `lakera_ready` (if Phase 20 added it) | Student app + Parrot Worker | `true` |
| `ok` or `status: ok` | Graph proxy `/healthz` | `true` |

Any `false` or missing field that was previously green is a regression. Identify which token rotation caused it using the commit history and rollback the appropriate section.

### JWKS verification

```bash
echo "=== STUDENT CLERK JWKS ===" && curl -s https://clerk.internjobs.ai/.well-known/jwks.json | jq '{key_count: (.keys | length), first_kid: .keys[0].kid}'
echo "=== WORKSPACE CLERK JWKS ===" && curl -s https://clerk.workspace.internjobs.ai/.well-known/jwks.json | jq '{key_count: (.keys | length), first_kid: .keys[0].kid}'
```

Expected: both return `key_count >= 1` and a non-null `first_kid`. An empty `keys` array means the Clerk app's JWT signing configuration is broken — this is unrelated to Secret Key rotation but must be investigated before shipping.

### Error rate watch — 15 minutes

After the green-board sweep, watch both Clerk apps for 15 minutes with no error rate spike.

**Cloudflare dashboard error rate:**
1. Go to `https://dash.cloudflare.com` → Workers & Pages → `internjobs-parrot`
2. Click **Metrics** → look at the Error Rate graph for the last 30 minutes.
3. Baseline is near 0%. Any spike above ~1% in the post-rotation window indicates a problem.

**Fly app logs:**
```bash
fly logs --app internjobs-ai-student-app | grep -i "error\|401\|403\|clerk" &
```
Watch for 5 minutes. `Ctrl+C` when done. Any `401` from Workers AI or Clerk in the post-rotation window is a rollback signal.

**Clerk dashboard error rate:**
1. Tab A: Student Clerk app → **Monitoring** → check for any auth failure spikes in the last 30 minutes.
2. Tab B: Workspace Clerk app → **Monitoring** → same check.

Baseline is near zero errors. A spike immediately after rotation indicates a mis-configured new key.

---

## Do NOT Do These

This section exists to name the failure modes explicitly so they cannot be missed:

**DO NOT rotate Clerk JWT Signing Keys.**
Rotating a JWT Signing Key (distinct from the Secret Key) immediately invalidates all active sessions. Every employee must re-authenticate via phone OTP. Every student must re-authenticate via LinkedIn. This is the nuclear option. The requirements for this runbook specify rotating Secret Keys only. If you accidentally navigated to "JWT Signing Keys" in the Clerk dashboard — close that tab.

**DO NOT batch-revoke multiple CF tokens simultaneously.**
Cloudflare has no grace period. Revoking two tokens at once doubles the blast radius if something goes wrong. Revoke one, verify, then proceed to the next.

**DO NOT revoke the old CF AI token until BOTH Fly AND Worker are verified on the new token.**
The shared `CLOUDFLARE_AI_API_TOKEN` constraint is the single highest-risk action in this runbook. Both consumers must be verified green before the old token dies.

**DO NOT write the new broad CF token to Infisical before updating your local shell.**
Wrangler reads from your shell environment, not Infisical. Infisical is the audit record, not the deploy mechanism for this token. Write to shell first, confirm wrangler works, THEN write to Infisical.

**DO NOT run `wrangler deploy --dry-run` as a sanity check.**
The `virtual:react-router/server-build` error in the Parrot workspace causes every `--dry-run` invocation to fail. It is a pre-existing build artifact issue unrelated to your changes. Use `wrangler secret put <KEY>` + healthz check as your verification pattern instead.

**DO NOT skip the Infisical write step for any token.**
If you deploy via `fly secrets set` or `wrangler secret put` without also updating Infisical, the next deploy that pulls from Infisical will re-inject the old (now revoked) value and break the service. Infisical is the source of truth — always update it as part of the rotation sequence.

---

## Completion Checklist

Mark each item only after the corresponding verification passed and the old token was revoked.

- [ ] **Section 1 complete:** Clerk student app `CLERK_SECRET_KEY` rotated — old key deleted in Clerk dashboard, `/healthz clerk: true`, JWKS resolves.
- [ ] **Section 2 complete:** Clerk workspace app `PARROT_CLERK_SECRET_KEY` rotated — old key deleted in Clerk dashboard, Parrot Worker healthz green, workspace JWKS resolves.
- [ ] **Section 3 complete:** `CLOUDFLARE_EMAIL_API_TOKEN` (and/or `CLOUDFLARE_EMAIL_ROUTING_API_TOKEN`) rotated — old token revoked in CF dashboard, Parrot Worker healthz green.
- [ ] **Section 4 complete:** `CLOUDFLARE_AI_API_TOKEN` rotated — student app `workersAiReady: true` + Worker AI gateway health green — old token revoked in CF dashboard.
- [ ] **Section 5 complete:** `GRAPH_API_SECRET` rotated — `graph_ready: true` and `graph_proxy_reachable: true` on Parrot Worker healthz.
- [ ] **Section 6 complete:** `LAKERA_GUARD_API_KEY` rotated — old key revoked on Lakera platform, both consumers healthz green.
- [ ] **Section 7 complete:** Broad CF API token rotated — local shell updated, wrangler whoami works, all healthz green, old token revoked in CF dashboard.
- [ ] **Post-rotation green-board passed:** All 4 healthz endpoints fully green, both JWKS endpoints resolving, 15-minute error rate watch at baseline.
- [ ] **All Infisical entries verified correct:** Run a final `infisical secrets list --projectId 26995afd-9a6f-4690-912f-01cbcebb76d5 --env prod --path /internjobs-ai` and confirm all rotated secrets show their new values.
- [ ] **v1.3 milestone complete.** The green-board above is the definitive v1.3 ship signal.

---

*Runbook created: 2026-05-19 — Phase 21, v1.3 Pilot Hardening*
