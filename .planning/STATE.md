---
schema_version: 2
milestone: "v1.2"
phase: 6
phase_name: "Two-Sided Integration Smoke Test"
phase_total: 6
plan: 0
plan_total: 0
status: "in_progress"
progress: 90
last_activity: "2026-05-16"
session_last: "2026-05-16"
# 2026-05-16: Workers AI direct tear-out — apps/ai-worker proxy Worker removed; Fly Node app calls Cloudflare Workers AI REST directly with CLOUDFLARE_AI_API_TOKEN. /healthz: aiProxyReady → workersAiReady.
# 2026-05-16: Workers AI swap (OpenAI → Cloudflare Workers AI via internjobs-ai-proxy). Embedding dim 1536 → 768. Deployed live + smoke-tested in prod.
resume_file: ".planning/milestones/v1.2-two-sided-agent-mvp/USER-ACTIONS.md"
blockers:
  - "All 6 v1.2 phases code-complete + post-launch 2026-05-16 Workers AI tear-out deployed live to prod. The OPENAI_API_KEY user-action is DROPPED. The proxy Worker (`apps/ai-worker/`) is also DROPPED — Fly Node app now calls Cloudflare Workers AI REST API directly with `CLOUDFLARE_AI_API_TOKEN` (Workers-AI-scoped). Remaining work is user-only: DNS proxy fix, Clerk key rotation, Clerk strategy enablement, operator publicMetadata, CF Email Routing setup, Cloudflare Email Service onboarding (Account ID + Email-Sending-scoped API token), R2 bucket creation (`internjobs-agent-store`) + R2 API token + four R2_* envs in Infisical, INTEG-01 11-step smoke test in prod. See .planning/milestones/v1.2-two-sided-agent-mvp/USER-ACTIONS.md for the ordered checklist (Section B2 covers R2 setup; Section A5 — OPENAI_API_KEY — and the proxy Worker user-action are now dropped)."
  - "SEC-ROTATE-CF-EMAIL-01: rotate the Cloudflare Email Service API token pasted in chat 2026-05-16. Same posture as SEC-ROTATE-01 (Clerk). Update Infisical `prod`/`/internjobs-ai` → `CLOUDFLARE_EMAIL_API_TOKEN` and re-run flyctl secrets import. Do AFTER Section E smoke-test passes."
  - "SEC-ROTATE-CF-AI-01 (NEW 2026-05-16 tear-out): rotate the Cloudflare Workers AI API token pasted in chat 2026-05-16. Same posture as SEC-ROTATE-CF-EMAIL-01. Update Infisical `prod`/`/internjobs-ai` → `CLOUDFLARE_AI_API_TOKEN` and re-run flyctl secrets import. Do AFTER the next post-launch verification pass."
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-15)
See: .planning/REQUIREMENTS.md (defined 2026-05-16)
See: .planning/ROADMAP.md (created 2026-05-16)
See: .planning/milestones/v1.2-two-sided-agent-mvp/USER-ACTIONS.md (created 2026-05-16)

**Core value:** InternJobs.ai helps students and startups meet through natural messages, not resume piles or application black holes.
**Current focus:** v1.2 — all phase code shipped (plus 2026-05-16 Resend → Cloudflare Email Service swap); user-action checklist (DNS / secrets / Clerk dashboard / CF Email Routing / CF Email Sending onboard / deploy / smoke test) is the remaining gate.

## Current Position

Milestone: v1.2 — Two-Sided Agent MVP
Phase: 6 of 6 (Two-Sided Integration Smoke Test) — code artifacts committed (runbook + admin endpoint), but the actual smoke test against prod is the user's job and is gated by Sections A–D of USER-ACTIONS.md.
Plan: —
Status: All phase code shipped (16 commits across Phases 01–06). Awaiting user actions before INTEG-01 can run.
Last activity: 2026-05-16 — Phases 01–06 executed end-to-end via parallel planning + sequential execution; all v1.1 smoke tests still pass at every step; structural "no auto-send" invariant verified.

Progress: █████████░ 90% (code 100%, prod-deploy + smoke test pending user actions)

## Performance Metrics

**Velocity (cumulative):**

- Total plans completed: 22 (v1.0: 15, v1.1: 1, v1.2: 6)
- Total phases completed: 7 + 6 code-complete = 13 (last 6 awaiting user verification)
- Milestones shipped: 2 (v1.0, v1.1); v1.2 code-complete, awaiting prod activation

**v1.2 progress:**

| Phase | Plans | Status | Commits |
|-------|-------|--------|---------|
| 01. Pre-flight + SMS Abstraction | 1 | Code-complete (USER ACTION blocks: DNS, Clerk rotate, fly deploy) | f8f01bb, 52cf272 |
| 02. Startup Identity, Consent & Roles | 1 | Code-complete (USER ACTION blocks: Clerk strategy enable, migrate, deploy) | b8aa57b, 90a36c4, 7918567, 182b4f0 |
| 03. Startup Email Channel | 1 | Code-complete (USER ACTION blocks: CF Email Routing, CF Email Sending onboard, secrets, wrangler deploy, fly deploy). 2026-05-16: outbound provider swapped from Resend to Cloudflare Email Service. | 75f809a, e9478b4 |
| 04. Mastra Agent Core | 1 | Code-complete (USER ACTION blocks: OPENAI_API_KEY, migrate, fly deploy, optional load test) | 4b9706b, b793fd3, 0422272 |
| 05. Operator Approval Gate | 1 | Code-complete (USER ACTION blocks: set publicMetadata.userType='operator', fly deploy) | e27cc19, 8e19fa9 |
| 06. Two-Sided Integration Smoke Test | 1 | Code artifacts shipped (runbook + admin endpoint); the actual 11-step prod smoke test is the user's hands | 9f84368, e1c21e9, 0013630 |
| Scope-add (STORAGE-01) — R2 storage scaffold | — | Code-complete (USER ACTION blocks: B2 bucket + token + envs). Smoke tests pass (16 unit + 4 integration). | 830aa0f |
| Scope-add (EMAIL-03) — per-conversation Reply-To aliases | — | Code-complete. Smoke tests pass (9 unit + 5 integration). No new USER ACTION (reuses Phase 03 B5 catch-all rule). | f3b5a8f |

## Accumulated Context

### Decisions logged this session

- `SmsProvider` interface lives at `apps/app/src/sms/provider.mjs` (JSDoc contract) + `apps/app/src/sms/spectrum.mjs` (implementation). Wire-through via `smsProvider.{verifyWebhook,parseInbound,sendSms,listen}` in `server.mjs` and `spectrum-listener.mjs`.
- Single Clerk app + `publicMetadata.userType` discriminator (`student | startup | operator`). No second Clerk app. `requireOperatorAuth` re-fetches `publicMetadata` via Clerk Backend API on every operator request (not the JWT) per PITFALLS #13.
- Mastra runs in-process inside the existing Express app. Dedicated `mastra` Postgres schema. `@mastra/core@1.35.0` exact pin. `@mastra/pg@1.11.0` adapter. `text-embedding-3-small` (1536 dims) locked in migration.
- pgvector HNSW indexes created in-transaction (CONCURRENTLY dropped — `migrate.mjs` wraps each migration in BEGIN/COMMIT). Safe at v1.2 data volume.
- Unified outbound router lives at `apps/app/src/outbound.mjs`. It is the SOLE module that calls `smsProvider.sendSms` or `sendStartupEmail` for agent drafts. Verified by grep at end of Phase 05.
- v1.1 pairing welcome SMS remains an auto-send (the one pre-existing exception; not an agent draft).
- CF Email Worker + Fly ingest use HMAC-SHA256 with Node `crypto.timingSafeEqual` for verification. Worker falls back to `message.forward(OPERATOR_FALLBACK)` on Fly failure per PITFALLS #7. Cloudflare Queues deferred (TODO note in Worker code).
- Phase 04 Flag 2/3 fixes applied: `student_threads.provider='cognee' → 'mastra'` data migration; `confirmPairingCode` parameterized on `provider` (was hardcoded `'photon'`).
- 2026-05-16: EMAIL-02 outbound provider swapped from Resend to Cloudflare Email Service (the "Agent Mail" product, public beta 2026-04-17). Rationale: internjobs.ai is already on Cloudflare DNS (the hard prereq), already uses CF Email Routing for inbound, and standardizing on one vendor for email cuts an integration. Implementation: `apps/app/src/email/outbound.mjs` rewritten as a `fetch()` call to `POST /accounts/{account_id}/email/sending/send` (no SDK, no new npm dep — `resend` removed). Config keys swapped to `CLOUDFLARE_EMAIL_ACCOUNT_ID` + `CLOUDFLARE_EMAIL_API_TOKEN`; `/healthz` now reports `cloudflareEmailReady`. Future v1.3 could move the call into a Worker binding — out of scope here.
- 2026-05-16: **STORAGE-01 scope-add** — R2 storage scaffold ported (and trimmed) from SuperIntelligence `r2-uploads-client.ts`. Private bucket `internjobs-agent-store` with per-entity folder convention (`students/{id}/`, `startups/{id}/`, `conversations/{id}/`, `startups/{id}/roles/{role_id}/`). Signed-URL-only sharing (Mala posture — every share is auditable + time-bounded). Client at `apps/app/src/storage/r2.mjs` fails soft (returns null) on missing envs; `/healthz` reports `r2Ready`. NO ingestion wired yet — STORAGE-02 (v1.3) lands attachment ingest; STORAGE-03 (v1.3) lands permanent short links via mapping bucket. Rationale: row-level partition via student_id/startup_id is sufficient for InternJobs's volume; per-user Postgres schemas (SuperIntelligence's stronger isolation) are too heavyweight here.
- 2026-05-16: **EMAIL-03 scope-add** — per-conversation Reply-To aliases (`conv-{conversation_id}@internjobs.ai`) become the PRIMARY inbound startup identification path. Catch-all CF Email Routing rule (Phase 03 B5) already routes any `*@internjobs.ai` to the Worker; we now parse the `conv-` prefix and ship the UUID in the signed JSON payload. Fly /webhooks/email validates and writes it into `inbound_messages.metadata.conversation_id`. Replaces fragile From-address lookup; legacy lookup stays as fallback. Stamped onto outbound drafts via `agent_metadata.reply_to` (read by `outbound.mjs` and passed through to CF's `reply_to` field). New audit event_type `startup_email_received_by_alias` distinguishes the deterministic path.
- 2026-05-16: **Workers AI swap** — replaced OpenAI (embeddings + chat completions) with Cloudflare Workers AI via a thin proxy Worker `internjobs-ai-proxy` (`apps/ai-worker/`). The Worker uses the native `env.AI` binding, so the Fly Node app never holds a Cloudflare API token — auth is a shared `AI_WORKER_SECRET` (constant-time compared in the Worker; stored in both Infisical and wrangler). Embedding model is `@cf/baai/bge-base-en-v1.5` (768-dim, down from OpenAI's 1536); chat model is `@cf/meta/llama-3.1-8b-instruct`. Best-effort AI Gateway routing via `{gateway:{id:'internjobs-ai'}}` — calls succeed even when the gateway doesn't exist (CF error code 2001 → silent fallback to direct Workers AI). Migration 0005 swapped both `student_embeddings.embedding` and `role_embeddings.embedding` from `vector(1536)` to `vector(768)` (tables were empty, safe atomic change) and rebuilt HNSW indexes. The `openai` npm dep was removed; `apps/app/src/embeddings.mjs` and `apps/app/src/workflows/student-inbound.mjs` now use plain `fetch()` to the Worker. `/healthz` drops `openaiKeyPresent` and adds `aiProxyReady`. Stub fallback (`LLM_PROVIDER=stub` or missing `AI_WORKER_*` envs) preserved so dev/test boots without secrets. Deployed live to prod 2026-05-16. End-to-end smoke confirmed in prod (`aiProxyReady: true`; manual /embed returns 768-dim vec; manual /chat returns Llama response).
- 2026-05-16: **Workers AI direct tear-out** — torn out the `apps/ai-worker/` proxy Worker entirely. User provided a Cloudflare API token (`CLOUDFLARE_AI_API_TOKEN`) with Workers AI scope confirmed (returned a 768-dim embedding from `POST /accounts/{id}/ai/run/@cf/baai/bge-base-en-v1.5`). Fly Node app now calls the Workers AI REST API directly from `apps/app/src/embeddings.mjs` and `apps/app/src/workflows/student-inbound.mjs` — no proxy Worker, no AI Gateway intermediary in v1.2 (AI Gateway probe returned 401, so we route direct; AI Gateway can be added later by changing the URL prefix). Rationale: one less moving part (no wrangler deploy, no shared-secret rotation, no extra hop). Config keys swap: `aiWorker.{url, secret}` → `cloudflareAi.{accountId, apiToken}`. Env keys swap: `AI_WORKER_URL` + `AI_WORKER_SECRET` → `CLOUDFLARE_AI_ACCOUNT_ID` + `CLOUDFLARE_AI_API_TOKEN`. `/healthz` drops `aiProxyReady` and adds `workersAiReady`. Infisical: deleted `AI_WORKER_URL` + `AI_WORKER_SECRET`; added `CLOUDFLARE_AI_ACCOUNT_ID` (mirroring `CLOUDFLARE_EMAIL_ACCOUNT_ID` value under a cleaner AI-namespace name); `CLOUDFLARE_AI_API_TOKEN` was already added pre-task. Fly: unstaged `AI_WORKER_URL` + `AI_WORKER_SECRET`; staged + imported `CLOUDFLARE_AI_ACCOUNT_ID` + `CLOUDFLARE_AI_API_TOKEN`. Response-shape change (vs. proxy): direct Workers AI returns `{ result: { data: [[...]] | response: "..." }, success, errors }` — embeddings unwrap `result.data[0]`, chat unwraps `result.response`. Stub fallback preserved (now keyed on `CLOUDFLARE_AI_*` envs instead of `AI_WORKER_*`). Migration 0005 untouched — vector column stays `vector(768)`, model stays `@cf/baai/bge-base-en-v1.5`. SEC-ROTATE-CF-AI-01 added to backlog. Build smoke passes (`npm run build:app`).

### Pending Todos (user-only — see USER-ACTIONS.md for ordered checklist)

- Section A: Cloudflare DNS proxy fix; rotate `CLERK_SECRET_KEY`; enable email/Google/Microsoft in Clerk; set operator `publicMetadata.userType`. (Section A5 — `OPENAI_API_KEY` — was DROPPED 2026-05-16 by the Workers AI swap. The proxy Worker / `AI_WORKER_*` user-action was also DROPPED 2026-05-16 by the Workers AI direct tear-out.)
- Section B: Generate `EMAIL_WORKER_SECRET`; store in Cloudflare Worker AND Infisical; enable CF Email Routing on internjobs.ai; add catch-all rule to Worker; confirm `ops@internjobs.ai` fallback; `wrangler deploy`.
- **Section B2 (NEW 2026-05-16):** Create R2 bucket `internjobs-agent-store` (Standard, no public access); create bucket-scoped "Object Read & Write" R2 API token; store `R2_ACCOUNT_ID=0fffd3dc637bdb26d4963df445a69fd3` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` + `R2_BUCKET=internjobs-agent-store` in Infisical; re-run Fly secrets import. Verify `r2Ready: true` in /healthz after D2.
- Section C: Cloudflare Email Service onboard `internjobs.ai` (Email Sending → Onboard Domain → adds `cf-bounce` MX + SPF + DKIM + DMARC); create Account-scoped "Email Sending" API token; store `CLOUDFLARE_EMAIL_ACCOUNT_ID` + `CLOUDFLARE_EMAIL_API_TOKEN` in Infisical.
- Section D: Apply migrations 0003 + 0003b + 0004 to prod Neon; `fly deploy`; `/healthz` green-check (now including `r2Ready`).
- Section E: Run 11-step INTEG-01 protocol; fill VERIFICATION.md.
- Section F (optional): `/rrr:audit-milestone` + `/rrr:complete-milestone`.
- Post-E: SEC-ROTATE-CF-EMAIL-01 (rotate CF Email API token after Section E passes).

### Blockers/Concerns

- `migrate.mjs` has a latent double-insert bug into `schema_migrations` when migrations self-insert. Phase 04 executor noted this but didn't fix (out of scope). Flag for a follow-up hygiene plan if it bites during D1.
- Mastra is young (`@mastra/core@1.35.0` pinned). 20-concurrent inbound load spike test deferred from week 1 of v1.2 to a post-deploy canary in Phase 06 territory.
- Tracked but not formally in v1.2: SEC-ROTATE-01 (Clerk key rotation) — backlog in REQUIREMENTS.md; instructions in USER-ACTIONS.md Section A2.
- New 2026-05-16: SEC-ROTATE-CF-EMAIL-01 (Cloudflare Email Service token rotation) — backlog in REQUIREMENTS.md; do after Section E smoke-test passes.
- New 2026-05-16 (tear-out): SEC-ROTATE-CF-AI-01 (Cloudflare Workers AI token rotation) — backlog in REQUIREMENTS.md; do after the next post-launch verification pass.

## Session Continuity

Last session: 2026-05-16
Stopped at: All 6 v1.2 phases code-complete (16 commits on `main`) PLUS 2 swap commits (Resend → Cloudflare Email Service) PLUS 2 scope-add commits (STORAGE-01 R2 scaffold + EMAIL-03 per-conversation Reply-To aliases). User-action manifest at `.planning/milestones/v1.2-two-sided-agent-mvp/USER-ACTIONS.md` (new Section B2 for R2 bucket setup). Next step is for the user to work through Sections A→B→B2→C→D, then run the INTEG-01 smoke test (Section E), then rotate the CF Email API token (SEC-ROTATE-CF-EMAIL-01).
Resume file: .planning/milestones/v1.2-two-sided-agent-mvp/USER-ACTIONS.md
