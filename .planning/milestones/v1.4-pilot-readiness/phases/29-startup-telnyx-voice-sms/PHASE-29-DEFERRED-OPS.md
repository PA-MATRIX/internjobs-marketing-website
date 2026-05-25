# Phase 29 — Deferred Ops Backlog

**Owner:** Raj (manual portal/CLI ops; outside autonomous executor scope)
**Created:** 2026-05-25 during Plan 29-01 execution
**Session rule active:** "Don't wait on me — finish all the phases" (user, 2026-05-25)

This file captures every `checkpoint:human-verify` / `checkpoint:human-action`
item across Phase 29 that the executor cannot perform autonomously. Each entry
is structured as:

- **ID** — `DEFER-29-<plan>-<letter>`
- **What** — concrete action
- **Acceptance** — measurable signal that the step closed
- **Downstream blockers** — which deferred entries or future plans depend on this

Group by plan; close in any order unless a downstream blocker dictates otherwise.

---

## Plan 29-01 — SMS adapter + identity resolution + action enum

### DEFER-29-01-A — Telnyx account signup
- **What:** Create account at portal.telnyx.com; add a payment method.
- **Acceptance:** Logged into portal; payment method visible in Billing.
- **Downstream blockers:** Every other DEFER-29-01-* entry.

### DEFER-29-01-B — Toll-free number purchase
- **What:** Search for a toll-free number (800/888/877/866/855/844/833) and
  buy one. Note the E.164 value (e.g. `+18005551234`).
- **Acceptance:** Number visible in Telnyx portal → Numbers; E.164 value
  copied. Store as `STARTUP_TELNYX_NUMBER` in Infisical `/internjobs-ai`
  env=`prod` BEFORE using.
- **Downstream blockers:** DEFER-29-01-D, DEFER-29-01-G, DEFER-29-01-J.

### DEFER-29-01-C — Toll-free BRN verification submission
- **What:** Submit Business Registration Number verification in Telnyx portal:
  - `businessRegistrationNumber` = EIN (e.g. `12-3456789`)
  - `businessRegistrationType` = `EIN`
  - `businessRegistrationCountry` = `US`
- **Acceptance:** Verification submitted; portal shows "pending" status.
  Processing 1–2 weeks. Number can send/receive SMS immediately at low volume —
  deliverability ramps after approval.
- **Downstream blockers:** None (pilot volume tolerates pre-approval delivery).

### DEFER-29-01-D — Messaging profile creation
- **What:** Create a messaging profile in Telnyx portal; assign the toll-free
  number from DEFER-29-01-B; set the inbound webhook URL to:
  ```
  https://mcp.internjobs.ai/webhooks/telnyx/sms
  ```
- **Acceptance:** Messaging profile visible in portal; number assigned; webhook
  URL configured. Note the profile UUID (needed for DEFER-29-01-H).
- **Downstream blockers:** DEFER-29-01-H, DEFER-29-01-J.

### DEFER-29-01-E — API key generation + Infisical + wrangler secret
- **What:** Portal → API Keys → generate a new key. Store as `TELNYX_API_KEY`
  in Infisical `/internjobs-ai` env=`prod` (per [[feedback-secrets-to-infisical]]).
  Then `cd apps/startup && wrangler secret put TELNYX_API_KEY`.
- **Acceptance:** Infisical record present; `wrangler secret list` shows
  `TELNYX_API_KEY`.
- **Downstream blockers:** DEFER-29-01-I.

### DEFER-29-01-F — Webhook Ed25519 public key retrieval
- **What:** Portal → Messaging → Webhooks → copy the Ed25519 public key (base64
  encoded). Store as `TELNYX_WEBHOOK_PUBLIC_KEY` in Infisical. Then
  `cd apps/startup && wrangler secret put TELNYX_WEBHOOK_PUBLIC_KEY`.
- **Acceptance:** Infisical record present; `wrangler secret list` shows
  `TELNYX_WEBHOOK_PUBLIC_KEY`.
- **Downstream blockers:** Without this, `routes/telnyx.ts` skips signature
  verification and logs a warning per-request (intentional ops-deferred guard).

### DEFER-29-01-G — TELNYX_FROM_NUMBER wrangler secret put
- **What:** Same E.164 value as DEFER-29-01-B (STARTUP_TELNYX_NUMBER). Run
  `cd apps/startup && wrangler secret put TELNYX_FROM_NUMBER`. Also store in
  Infisical.
- **Acceptance:** `wrangler secret list` shows `TELNYX_FROM_NUMBER`.
- **Downstream blockers:** DEFER-29-01-I.

### DEFER-29-01-H — TELNYX_MESSAGING_PROFILE_ID wrangler secret put
- **What:** From the profile created in DEFER-29-01-D, copy the UUID. Run
  `cd apps/startup && wrangler secret put TELNYX_MESSAGING_PROFILE_ID`. Also
  store in Infisical for ops continuity.
- **Acceptance:** `wrangler secret list` shows `TELNYX_MESSAGING_PROFILE_ID`.
- **Downstream blockers:** Optional but recommended for US toll-free
  deliverability.

### DEFER-29-01-I — Worker redeploy after secrets bound
- **What:** `cd apps/startup && wrangler deploy`. All five Telnyx secrets
  (API_KEY, FROM_NUMBER, MESSAGING_PROFILE_ID, WEBHOOK_PUBLIC_KEY,
  VOICE_AGENT_TOKEN from Plan 29-02) should be bound first to avoid mid-flight
  re-deploys.
- **Acceptance:** New Worker version ID printed; `wrangler tail` shows no
  startup errors; `GET https://mcp.internjobs.ai/healthz` returns `{ok:true}`.
- **Downstream blockers:** DEFER-29-01-J.

### DEFER-29-01-J — Smoke test (text the toll-free)
- **What:** From a personal phone, text "hello" to the toll-free number from
  DEFER-29-01-B.
- **Acceptance:**
  - `wrangler tail` shows `POST /webhooks/telnyx/sms` with `event_type:message.received`.
  - The phone receives the unknown-number invite SMS:
    `"Hi! To connect your startup to InternJobs, call us at <number> — we'll get you set up in 30 seconds. Or text INVITE for an onboarding link."`
- **Downstream blockers:** Closes the Plan 29-01 ship loop.

### DEFER-29-01-K — Migration 0014 apply
- **What:** Apply `apps/app/db/migrations/0014_v1_4_telnyx_touchbase.sql` to
  the Fly Postgres (`internjobs-student-db`). Run via the same `migrate.mjs`
  runner used for 0011/0012/0013.
- **Acceptance:** `SELECT column_name FROM information_schema.columns WHERE
  table_name='startup_channel_links' AND column_name='last_touchbase_at';`
  returns one row. Migration row appears in `schema_migrations`.
- **Downstream blockers:** Plan 29-03 (weekly cron query reads this column).

---

## Plan 29-02 — Voice AI Agent + R2 audit log

### DEFER-29-02-A — Voice AI Agent creation in Telnyx portal
- **What:** Go to portal.telnyx.com → AI → Assistants → New Assistant.
  Paste config from `docs/VOICE_AGENT_CONFIG.md` into the corresponding portal
  fields (system prompt, greeting, model). Configure tools/integration based
  on plan tier:
  - **If MCP Servers tab is visible:** set MCP Server URL =
    `https://mcp.internjobs.ai/mcp`, auth type = `Bearer`, token =
    `TELNYX_VOICE_AGENT_TOKEN` (per DEFER-29-02-C).
  - **If MCP Servers tab is NOT available (plan-gated):** fall back to
    webhook-tool config — register `register_startup` + `show_candidate`
    webhook tools at `https://mcp.internjobs.ai/webhooks/telnyx/voice-tool`
    (per `docs/VOICE_AGENT_CONFIG.md` Step 4b). Set
    `TELNYX_USE_MCP_INTEGRATION=false` (DEFER-29-02-D).
  - Set Dynamic Variables Webhook URL =
    `https://mcp.internjobs.ai/webhooks/telnyx/voice-init`.
  - Set Post-Call Insights Webhook URL =
    `https://mcp.internjobs.ai/webhooks/telnyx/voice-postprocess`.
  - Assign toll-free number from DEFER-29-01-B to this agent.
- **Acceptance:** Agent visible in Telnyx portal; calling the toll-free number
  reaches the AI assistant with the configured greeting.
- **Downstream blockers:** DEFER-29-02-F (smoke test).

### DEFER-29-02-B — R2 bucket creation + wrangler.jsonc binding uncomment
- **What:** Run `cd apps/startup && wrangler r2 bucket create internjobs-voice-audit`.
  Then edit `apps/startup/wrangler.jsonc` and uncomment the line
  `"r2_buckets": [{ "binding": "VOICE_AUDIT", "bucket_name": "internjobs-voice-audit" }]`
  (the stub line is commented with a `// Phase 29-02 R2 binding — uncomment after running DEFER-29-02-B`
  marker).
- **Acceptance:** `wrangler r2 bucket list` shows `internjobs-voice-audit`;
  `wrangler.jsonc` binding line is uncommented; `wrangler deploy` succeeds.
- **Downstream blockers:** DEFER-29-02-E (worker redeploy), DEFER-29-02-F
  (smoke test verifies R2 writes).

### DEFER-29-02-C — TELNYX_VOICE_AGENT_TOKEN minting + Infisical + wrangler
- **What:** Mint a dedicated MCP install token for the Voice AI agent's
  "onboarding" persona via `POST /admin/startups/new` with a sentinel
  `company` value (e.g. `__onboarding__`) and a synthetic founder email +
  phone — the returned `token` field is what the Voice AI agent uses as its
  Bearer when calling `/mcp`. (Alternative: add a `POST /admin/tokens/mint`
  endpoint that returns just a token without creating a startup row;
  v1.5 follow-up.)
  Store the token as `TELNYX_VOICE_AGENT_TOKEN` in Infisical `/internjobs-ai`
  env=`prod` BEFORE using. Then `cd apps/startup && wrangler secret put TELNYX_VOICE_AGENT_TOKEN`.
- **Acceptance:** Infisical record present; `wrangler secret list` shows
  `TELNYX_VOICE_AGENT_TOKEN`; Voice AI agent's MCP Server Bearer field is
  populated in the Telnyx portal.
- **Downstream blockers:** DEFER-29-02-A (Voice AI agent creation),
  DEFER-29-02-E (worker redeploy).

### DEFER-29-02-D — TELNYX_USE_MCP_INTEGRATION feature-flag secret
- **What:** After DEFER-29-02-A confirms which path is available:
  - **MCP path:** `cd apps/startup && wrangler secret put TELNYX_USE_MCP_INTEGRATION`,
    value: `true`.
  - **Webhook-tool path:** value: `false` (or leave the secret unbound — the
    `voice-tool` handler defaults to webhook-tool mode when the secret is
    not equal to the literal string `"true"`).
- **Acceptance:** `wrangler secret list` shows `TELNYX_USE_MCP_INTEGRATION`
  (when MCP path); the Voice AI agent's tool calls reach the expected handler
  during DEFER-29-02-F smoke test.
- **Downstream blockers:** DEFER-29-02-E, DEFER-29-02-F.

### DEFER-29-02-E — Worker redeploy after R2 bucket + secrets are bound
- **What:** `cd apps/startup && wrangler deploy`. Should follow
  DEFER-29-02-B + DEFER-29-02-C + DEFER-29-02-D so the deployed Worker has
  the R2 binding live and the Voice AI agent token available for any
  per-caller token-injection logic (v1.5).
- **Acceptance:** New Worker version ID printed; `GET https://mcp.internjobs.ai/healthz`
  returns `{ok:true}`; `wrangler tail` shows no startup errors.
- **Downstream blockers:** DEFER-29-02-F.

### DEFER-29-02-F — Smoke test voice intake end-to-end
- **What:** Call the toll-free number from DEFER-29-01-B from a personal phone.
- **Acceptance:**
  - AI greets with the opt-in disclosure greeting from `docs/VOICE_AGENT_CONFIG.md`.
  - AI asks the 4 intake questions (company, founder name, work email, what hiring for).
  - After completion: SMS arrives at the calling phone with the MCP install snippet
    (delivered by `handleRegisterStartupFromVoice` → `sendSms`).
  - `wrangler tail` shows `POST /webhooks/telnyx/voice-init` (before call) and
    `POST /webhooks/telnyx/voice-postprocess` (after call hangup).
  - R2 bucket `internjobs-voice-audit` contains two objects under
    `transcripts/<startup_id>/<call_control_id>.json` and
    `recordings/<startup_id>/<call_control_id>.mp3` (verify via
    `wrangler r2 object list internjobs-voice-audit`).
- **Downstream blockers:** Closes the Plan 29-02 ship loop. After this passes,
  the LOW-confidence post-call payload field names from the research doc are
  validated against the real Telnyx payload — adjust the optional-chaining
  fallback chain in `routes/voice.ts` voice-postprocess if needed (raw payload
  is logged to console for first-call hotfix-ability).

---

## Plan 29-03 — Weekly cron + reply parser + opt-in

*(To be appended when 29-03 executes; placeholders documented in the plan file.)*

---

## Notes

- All Phase 29-01 code ships in **ops-deferred mode** — `routes/telnyx.ts` and
  `lib/telnyx.ts` both guard on `env.TELNYX_*` being defined and log a warning
  when they're not. No request will 500 because a secret is missing.
- The signature verification skip path is intentionally permissive only when
  `TELNYX_WEBHOOK_PUBLIC_KEY` is unbound. Once bound, all unsigned/tampered
  payloads will receive 401. This matches the Phase 28.5-05 Clerk webhook
  pattern (503 when secret unbound, 400 on bad sig once bound).
- Per [[feedback-secrets-to-infisical]], EVERY secret listed in `wrangler
  secret put` lines above MUST be stored in Infisical FIRST. Don't let the
  Telnyx portal value live only in chat history.
