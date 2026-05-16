# v1.2 — User Actions Manifest

**Status as of 2026-05-16:** All v1.2 code is committed across 16 commits on `main` (Phases 01–06). What follows are the dashboard / DNS / API-key / deploy / smoke-test steps that only you can run. Work top-down — there are real dependencies (e.g. Resend API key must exist before Fly redeploys with the key in scope).

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

### A5. Add `OPENAI_API_KEY` to Infisical (Phase 04 prerequisite)

- Infisical `prod` `/internjobs-ai` → add `OPENAI_API_KEY` (your OpenAI key with embeddings + chat-completions access).
- Re-run the Fly secrets import (same command as A2).

---

## Section B — Cloudflare Email Routing + Worker (Phase 03 inbound)

### B1. Generate the shared HMAC secret

- Locally: `openssl rand -hex 32` — copy the value, you'll paste it twice.

### B2. Store `EMAIL_WORKER_SECRET` in both places

- Cloudflare Worker: `cd apps/email-worker && npx wrangler secret put EMAIL_WORKER_SECRET` → paste the hex value.
- Infisical `prod` `/internjobs-ai` → add `EMAIL_WORKER_SECRET` → same hex value.
- Re-run Fly secrets import.

### B3. Confirm or change the fallback forward address

- Default in `apps/email-worker/src/index.js` is `ops@internjobs.ai`. If that address doesn't exist as a deliverable mailbox, either set it up (Email Routing forward to your inbox) OR edit `OPERATOR_FALLBACK` in `apps/email-worker/src/index.js` to a real address you own, commit, and continue.

### B4. Enable Cloudflare Email Routing on `internjobs.ai`

- Cloudflare dashboard → `internjobs.ai` → Email → Email Routing → enable.
- Cloudflare will auto-create the inbound MX records. Wait for them to propagate (a few minutes).

### B5. Add the catch-all routing rule

- Email Routing → Routes → add catch-all rule: `*@internjobs.ai` → Send to a Worker → `internjobs-email-ingest`.
- This single rule handles both `startups@internjobs.ai` (Phase 03) and future `conv_{conversation_id}@internjobs.ai` reply-to addresses (Phase 04+).

### B6. Deploy the Worker

- `cd apps/email-worker && npx wrangler deploy`
- Worker URL doesn't matter (it's an Email event handler, not an HTTP endpoint).

---

## Section C — Resend domain verification (Phase 03 outbound)

### C1. Sign up + add domain

- Sign up at `resend.com` (use `rentalaraj@gmail.com`).
- Dashboard → Domains → Add `internjobs.ai`.

### C2. Add DNS records in Cloudflare

- Resend will show SPF + DKIM + (optionally) DMARC records.
- Add them as TXT / CNAME records in Cloudflare DNS for `internjobs.ai` zone.
- These coexist with the inbound MX from B4 — different record types, no conflict.

### C3. Verify in Resend

- Resend dashboard → click "Verify DNS" until all records turn green.

### C4. Generate API key + store

- Resend → API Keys → Create. Name `internjobs-fly-prod`, "Sending" scope.
- Infisical `prod` `/internjobs-ai` → add `RESEND_API_KEY`.
- Re-run Fly secrets import.

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
- `emailWorkerSecret`, `resendApiKey` (Phase 03)
- `mastraReady`, `pgvectorReady`, `openaiKeyPresent` (Phase 04)

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
- **A2 + A5** load the secrets so deploy doesn't restart with stale `CLERK_SECRET_KEY` or no `OPENAI_API_KEY`.
- **A3** unlocks startup sign-in; **A4** unlocks `/ops/*` for you.
- **B** lights up inbound email (Worker exists; needs CF Email Routing + secret in two places).
- **C** lights up outbound email (Resend account + domain + API key).
- **D** ships the code with migrations applied.
- **E** is the acceptance test — INTEG-01 is the v1.2 contract.
- **F** archives and rolls into v1.3.

If you do **A** + **D** only, you can already test student paths and startup auth + roles + the operator dashboard with seeded drafts — you just can't test the email channel or agent send loop until **B** + **C** are done.
