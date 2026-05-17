# v1.2 — User Actions Manifest

**Status as of 2026-05-16:** All v1.2 code is committed on `main` (Phases 01–06, the 2026-05-16 Resend → Cloudflare Email Service swap, the 2026-05-16 STORAGE-01 + EMAIL-03 scope-add, the 2026-05-16 Workers AI swap, the 2026-05-16 Workers AI direct tear-out — proxy Worker `apps/ai-worker/` removed; Fly Node app now calls Cloudflare Workers AI REST API directly — AND the 2026-05-16 EMAIL-03 subdomain isolation refactor — agent aliases moved from apex `internjobs.ai` to dedicated `agent.internjobs.ai` subdomain so the apex stays clean for human email; Worker + Fly redeployed live; Section B revised). What follows are the dashboard / DNS / API-key / deploy / smoke-test steps that only you can run. Work top-down — there are real dependencies (e.g. Cloudflare Email Service onboarding must complete before Fly redeploys with the credentials in scope).

**Workers AI direct status (2026-05-16):** Workers AI direct via `CLOUDFLARE_AI_API_TOKEN` (already in Infisical). Proxy Worker torn out. `/healthz` reports `workersAiReady: true`. Sections A5 (OpenAI key) and the prior proxy-Worker user-action are both dropped.

**Pending blocker (2026-05-16):** SEC-ROTATE-CF-EMAIL-01 — the Cloudflare Email Service API token pasted in chat 2026-05-16 should be rotated AFTER Section E smoke-test passes. Same posture as SEC-ROTATE-01 (Clerk). Update Infisical `prod`/`/internjobs-ai` → `CLOUDFLARE_EMAIL_API_TOKEN`; re-run `flyctl secrets import`.

**Pending blocker (2026-05-16 tear-out):** SEC-ROTATE-CF-AI-01 — the Cloudflare Workers AI API token pasted in chat 2026-05-16 should be rotated AFTER the next post-launch verification pass. Same posture as SEC-ROTATE-CF-EMAIL-01. Update Infisical `prod`/`/internjobs-ai` → `CLOUDFLARE_AI_API_TOKEN`; re-run `flyctl secrets import`.

---

## Section A — Identity & Secrets (do first; gates everything else)

### A1. Fix Cloudflare DNS proxy (SEC-01)

- Cloudflare dashboard → `internjobs.ai` zone → DNS → toggle `accounts.internjobs.ai` and `clerk.internjobs.ai` from "Proxied" (orange) to "DNS only" (gray).
- Verify: open `https://app.internjobs.ai` in incognito → "Sign in with LinkedIn" → completes → lands on `/pairing`. (This was the v1.1 carry-over.)

### A2. Rotate `CLERK_SECRET_KEY` (SEC-ROTATE-01)

- Clerk Dashboard → API Keys → rotate Secret Key for the Internjobs.ai app (`app_38BrRDRKnvbo7vlE2ZZtMc7hFPC`).
- Infisical: org `2c12f042-e98f-4fb3-8b40-16aec29f9b91`, project `26995afd-9a6f-4690-912f-01cbcebb76d5`, env `prod`, path `/internjobs-ai` → update `CLERK_SECRET_KEY`.
- Fly: `infisical run --projectId 26995afd-9a6f-4690-912f-01cbcebb76d5 --env prod --path /internjobs-ai -- flyctl secrets import --app internjobs-ai-student-app` (or your established re-import pipeline).

### A3. Enable additional Clerk auth strategies (Phase 02 prerequisite)

- Clerk Dashboard → User & Authentication → Email, Phone, Username → enable **Email** (password + verification code).
- Same screen → Social Connections → enable **Google** and **Microsoft**.
- LinkedIn stays enabled (do NOT disable — that's the student path).

### A4. Tag your own Clerk user as operator (Phase 05 prerequisite)

- Clerk Dashboard → Users → find your account → Edit public metadata → set:
  ```json
  { "userType": "operator" }
  ```
- This must be set in Clerk Dashboard or via the Clerk Backend API; never expose a route that lets a user set their own `publicMetadata.userType`.

### A5. ~~Add `OPENAI_API_KEY` to Infisical~~ — DROPPED 2026-05-16 (Workers AI direct tear-out)

This step is no longer needed. Workers AI direct via `CLOUDFLARE_AI_API_TOKEN` (already in Infisical at `/internjobs-ai`, env `prod`). The Fly Node app calls `api.cloudflare.com/client/v4/accounts/{id}/ai/run/...` directly from `apps/app/src/embeddings.mjs` and `apps/app/src/workflows/student-inbound.mjs` — no proxy Worker, no AI Gateway intermediary, no OpenAI key. Two envs are loaded on Fly: `CLOUDFLARE_AI_ACCOUNT_ID` + `CLOUDFLARE_AI_API_TOKEN`.

**Optional follow-up (not required for any phase to pass):**

- Cloudflare Dashboard → AI → AI Gateway → Create gateway → name `internjobs-ai`. To route through it, change the URL prefix in `apps/app/src/embeddings.mjs` + `apps/app/src/workflows/student-inbound.mjs` from `https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/{model}` to `https://gateway.ai.cloudflare.com/v1/{account_id}/internjobs-ai/workers-ai/{model}` (one literal swap each). Auth header and response shape stay the same. Gateway gives analytics + caching + per-route rate limits.

---

## Section B — Cloudflare Email Routing + Worker (Phase 03 inbound)

### B1. Generate the shared HMAC secret

- Locally: `openssl rand -hex 32` — copy the value, you'll paste it twice.

### B2. Store `EMAIL_WORKER_SECRET` in both places

- Cloudflare Worker: `cd apps/email-worker && npx wrangler secret put EMAIL_WORKER_SECRET` → paste the hex value.
- Infisical `prod` `/internjobs-ai` → add `EMAIL_WORKER_SECRET` → same hex value.
- Re-run Fly secrets import.

### B3. Confirm the operator fallback forward address

- Default in `apps/email-worker/src/index.js` (post 2026-05-16 subdomain isolation) is `rentalaraj@gmail.com`. This is the Worker's last-resort destination when (a) the Fly POST fails OR (b) a non-conv-prefixed email arrives on the agent subdomain (e.g. `info@agent.internjobs.ai`).
- This address MUST be a verified Destination Address in CF Email Routing (see B5a). If it isn't verified, `message.forward()` silently fails and the email is lost — there is no second fallback.
- If you want a different fallback, edit `OPERATOR_FALLBACK` in `apps/email-worker/src/index.js`, commit, and re-run B7 (`wrangler deploy`).

### B4. Enable Cloudflare Email Routing on the apex AND the agent subdomain

**Apex (`internjobs.ai`) — for human/employee email:**

- Cloudflare dashboard → `internjobs.ai` zone → Email → Email Routing → enable.
- Cloudflare auto-creates the apex inbound MX records. Wait a few minutes for propagation.

**Subdomain (`agent.internjobs.ai`) — for agent per-conversation aliases:**

- Same zone → Email Routing → Settings → add subdomain → `agent.internjobs.ai`. CF Email Routing has supported subdomains since Oct 2025.
- Cloudflare creates subdomain inbound MX records (separate from apex). Wait for propagation.
- The two zones share Destination Addresses but have INDEPENDENT routing rules.

### B5. Routing rules — apex vs. subdomain

**Apex routing (human email only — NOT the Worker):**

- Email Routing → Routes (apex view) → add **Custom address** rule: `raj@internjobs.ai` → forward to `rentalaraj@gmail.com`.
- Email Routing → Routes (apex view) → add **Catch-all** rule: `*@internjobs.ai` → forward to `rentalaraj@gmail.com`.
- These rules MUST NOT target the Worker. The apex is reserved for human inbox.

**Subdomain routing (agent Worker target):**

- Email Routing → Routes (subdomain view, `agent.internjobs.ai`) → add **Catch-all** rule: `*@agent.internjobs.ai` → **Send to a Worker** → `internjobs-email-ingest`.
- This single rule handles both `startups@agent.internjobs.ai` and `conv-{conversation_id}@agent.internjobs.ai` reply-to aliases.

### B5a. Verify `rentalaraj@gmail.com` as a Destination Address

- Email Routing → Settings → **Destination Addresses** → Add → `rentalaraj@gmail.com`.
- Cloudflare emails a verification link; click it from the Gmail inbox.
- Status must show **Verified** before B5 apex rules will accept it as a target AND before the Worker's `OPERATOR_FALLBACK` will deliver via `message.forward()`.

### B6. (Now empty — was the old single-catch-all step, replaced by B4 + B5.)

### B7. Deploy the Worker

- `cd apps/email-worker && npx wrangler deploy`
- Worker URL is `https://internjobs-email-ingest.rentalaraj.workers.dev` (informational only — Email Routing invokes the Worker via the `email()` handler, not the HTTPS URL).

---

## Section B2 — R2 storage scaffold (STORAGE-01 scope-add 2026-05-16)

Cloudflare R2 (S3-compatible) for the agent's per-entity artifact tree.
**Private bucket + signed-URL-only sharing** (matches the Mala posture from
SuperIntelligence). v1.2 ships only the storage layer at
`apps/app/src/storage/r2.mjs`; ingestion lands in v1.3 (STORAGE-02 for
email + MMS attachment writes; STORAGE-03 for permanent short links).

### B2.1. Create the R2 bucket

- Cloudflare dashboard → **R2 Object Storage** → **Create bucket**.
- Name: `internjobs-agent-store` (must match `R2_BUCKET` default in `config.mjs`).
- Storage class: Standard. **Public access: OFF** (never enable — every share is signed-URL only).

### B2.2. Create an R2 API token scoped to the bucket

- Cloudflare dashboard → R2 → **Manage R2 API Tokens** → **Create API token**.
- Permissions: **Object Read & Write**.
- Specify Bucket(s): scope to `internjobs-agent-store` ONLY (do NOT give account-wide access).
- TTL: leave default (no expiry) or set to ~1 year — your call. Note this in your rotation log.
- Save the **Access Key ID** and **Secret Access Key** (both shown once).
- Your **Account ID** is `0fffd3dc637bdb26d4963df445a69fd3` (the only account `rentalaraj@gmail.com` has access to).

### B2.3. Store credentials in Infisical

- Infisical `prod` `/internjobs-ai` → add:
  - `R2_ACCOUNT_ID` = `0fffd3dc637bdb26d4963df445a69fd3`
  - `R2_ACCESS_KEY_ID` = from B2.2
  - `R2_SECRET_ACCESS_KEY` = from B2.2
  - `R2_BUCKET` = `internjobs-agent-store`
- Re-run the Fly secrets import (same command as A2).

### B2.4. Verify

After D2 (Fly deploy), `/healthz` should include `"r2Ready": true`. If false:
- All four `R2_*` envs present in Fly? (`fly secrets list --app internjobs-ai-student-app`)
- The R2 client fails soft (returns null) on any missing env — partial config shows up in `/config/status` as a warning.

---

## Section C — Cloudflare Email Service onboarding (Phase 03 outbound)

Cloudflare Email Service (the "Agent Mail" product launched at Agents Week 2026,
public beta as of 2026-04-17) is the v1.2 outbound provider. Hard prereq:
`internjobs.ai` must be on Cloudflare DNS (it already is — same zone where the
Email Routing MX from B4 lives).

### C1. Onboard `internjobs.ai` for Email Sending

- Cloudflare dashboard → `internjobs.ai` zone → Email → **Email Sending** → **Onboard Domain**.
- Select `internjobs.ai`. Cloudflare will display a set of DNS records to add:
  - **MX bounce** on `cf-bounce.internjobs.ai`
  - **SPF TXT** (an `include:` entry — make sure it merges with the existing SPF from B4 if any; don't end up with two SPF TXTs on the apex)
  - **DKIM TXT**
  - **DMARC TXT** on `_dmarc.internjobs.ai`
- Click **Add records** (Cloudflare adds them automatically since the zone is in the same account). Wait a few minutes for propagation.
- These coexist with the inbound MX from B4 — different record names (`internjobs.ai` MX → Email Routing; `cf-bounce.internjobs.ai` MX → Email Sending bounce handling), no conflict.

### C2. Wait for verification

- The Email Sending dashboard shows each record status. Wait until all turn green / verified. (If a single record stays red after 10 min, click "Re-check"; if it persists, check that the SPF wasn't duplicated.)

### C3. Create an API token

- Cloudflare dashboard → top-right user menu → **My Profile** → **API Tokens** → **Create Token**.
- Use a **Custom Token**:
  - Permissions: **Account** → **Email Sending** → **Edit**.
  - Account Resources: include your account that owns `internjobs.ai`.
  - Name it `internjobs-fly-prod-email-sending`.
- Save the token value (one-time visible) and grab the **Account ID** from the dashboard sidebar.

### C4. Store credentials

- Infisical `prod` `/internjobs-ai`:
  - Add `CLOUDFLARE_EMAIL_ACCOUNT_ID` = the Account ID from C3.
  - Add `CLOUDFLARE_EMAIL_API_TOKEN` = the token from C3.
- Re-run the Fly secrets import (same command as A2).

---

## Section D — Apply migrations + deploy

### D1. Apply v1.2 migrations to prod Neon

Either via Fly SSH:
```
flyctl ssh console --app internjobs-ai-student-app -C "npm --workspace @internjobs/app run migrate"
```
or directly from a workstation with the `DATABASE_URL` exported:
```
npm --workspace @internjobs/app run migrate
```
Migrations applied: `0003_v1_2_startup_identity.sql`, `0003b_email_inbound.sql`, `0004_v1_2_mastra_agent_core.sql`.

### D2. Deploy the Fly app

- `cd apps/app && fly deploy --app internjobs-ai-student-app`
- Wait for the rollout to complete.

### D3. Health check

```
curl https://app.internjobs.ai/healthz | jq .
```
Expect every key TRUE:
- `clerk`, `database`, `photonNumber`, `photonWebhook`, `spectrumListener` (v1.0/1.1 keys)
- `emailWorkerSecret`, `cloudflareEmailReady` (Phase 03 — `cloudflareEmailReady` is true iff BOTH `CLOUDFLARE_EMAIL_ACCOUNT_ID` and `CLOUDFLARE_EMAIL_API_TOKEN` are set)
- `mastraReady`, `pgvectorReady`, `workersAiReady` (Phase 04 — `workersAiReady` is true iff BOTH `CLOUDFLARE_AI_ACCOUNT_ID` and `CLOUDFLARE_AI_API_TOKEN` are set; replaced `aiProxyReady` in the 2026-05-16 Workers AI direct tear-out, which in turn replaced `openaiKeyPresent` from the 2026-05-16 Workers AI swap)
- `r2Ready` (STORAGE-01 scope-add — true iff `R2_ACCOUNT_ID` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` all set AND the singleton constructed without error)

```
curl https://app.internjobs.ai/config/status | jq .
```
Expect `{"missing": []}`.

---

## Section E — INTEG-01 smoke test (Phase 06 acceptance)

Run the 11-step protocol in `apps/app/test/integ-01-runbook.md` against prod. Fill in `apps/app/test/integ-01-VERIFICATION.md` as you go.

You will need:
- A test phone able to text the Spectrum shared number.
- A test LinkedIn account (or use your own).
- A test startup-side Gmail and Outlook inbox.
- One test startup tagged with `publicMetadata.userType='startup'` (sign one up via `/startup` after A3 enables the strategies).

The `GET /admin/integ-01-status?student_id=<UUID>` endpoint returns 8 booleans + `all_passed` — useful for confirming each step before moving to the next.

INTEG-01 passes when:
- All 11 steps yield the expected Neon row(s) (no manual DB insert/update).
- The Section C audit query in the runbook shows zero outbound messages without a matching `drafts.status='sent'` row.
- VERIFICATION.md is filled in and committed.

---

## Section F — Close the milestone (optional, after E)

- `/rrr:audit-milestone` — verifies all phase artifacts are present.
- `/rrr:complete-milestone` — archives v1.2 and prepares the codebase for v1.3 (Telnyx adapter as the natural next).

---

## Why this list is ordered this way

- **A1** is the v1.1 carry-over — until DNS-only is set, no user of any type can authenticate, so nothing else is testable.
- **A2** loads the rotated `CLERK_SECRET_KEY` so deploy doesn't restart with the stale value. (A5 was the OpenAI key; it's dropped — the 2026-05-16 Workers AI swap moved LLM traffic to Cloudflare Workers AI, and the 2026-05-16 Workers AI direct tear-out further removed the `internjobs-ai-proxy` Worker. Fly Node app now calls Workers AI REST directly with `CLOUDFLARE_AI_API_TOKEN`.)
- **A3** unlocks startup sign-in; **A4** unlocks `/ops/*` for you.
- **B** lights up inbound email (Worker exists; needs CF Email Routing + secret in two places).
- **C** lights up outbound email (Cloudflare Email Sending domain onboard + API token).
- **D** ships the code with migrations applied.
- **E** is the acceptance test — INTEG-01 is the v1.2 contract.
- **F** archives and rolls into v1.3.

If you do **A** + **D** only, you can already test student paths and startup auth + roles + the operator dashboard with seeded drafts — you just can't test the email channel or agent send loop until **B** + **C** are done.
