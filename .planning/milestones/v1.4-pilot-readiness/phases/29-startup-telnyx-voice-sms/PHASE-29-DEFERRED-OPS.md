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

*(To be appended when 29-02 executes; placeholders documented in the plan file.)*

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
