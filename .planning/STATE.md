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
resume_file: ".planning/milestones/v1.2-two-sided-agent-mvp/USER-ACTIONS.md"
blockers:
  - "All 6 v1.2 phases code-complete (16 commits on main) + 2026-05-16 Resend → Cloudflare Email Service swap. Remaining work is user-only: DNS proxy fix, Clerk key rotation, Clerk strategy enablement, operator publicMetadata, CF Email Routing setup, Cloudflare Email Service onboarding (Account ID + Email-Sending-scoped API token), OPENAI_API_KEY, migrations applied to prod Neon, fly deploy, INTEG-01 11-step smoke test in prod. See .planning/milestones/v1.2-two-sided-agent-mvp/USER-ACTIONS.md for the ordered checklist."
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

### Pending Todos (user-only — see USER-ACTIONS.md for ordered checklist)

- Section A: Cloudflare DNS proxy fix; rotate `CLERK_SECRET_KEY`; enable email/Google/Microsoft in Clerk; set operator `publicMetadata.userType`; add `OPENAI_API_KEY` to Infisical.
- Section B: Generate `EMAIL_WORKER_SECRET`; store in Cloudflare Worker AND Infisical; enable CF Email Routing on internjobs.ai; add catch-all rule to Worker; confirm `ops@internjobs.ai` fallback; `wrangler deploy`.
- Section C: Cloudflare Email Service onboard `internjobs.ai` (Email Sending → Onboard Domain → adds `cf-bounce` MX + SPF + DKIM + DMARC); create Account-scoped "Email Sending" API token; store `CLOUDFLARE_EMAIL_ACCOUNT_ID` + `CLOUDFLARE_EMAIL_API_TOKEN` in Infisical.
- Section D: Apply migrations 0003 + 0003b + 0004 to prod Neon; `fly deploy`; `/healthz` green-check.
- Section E: Run 11-step INTEG-01 protocol; fill VERIFICATION.md.
- Section F (optional): `/rrr:audit-milestone` + `/rrr:complete-milestone`.

### Blockers/Concerns

- `migrate.mjs` has a latent double-insert bug into `schema_migrations` when migrations self-insert. Phase 04 executor noted this but didn't fix (out of scope). Flag for a follow-up hygiene plan if it bites during D1.
- Mastra is young (`@mastra/core@1.35.0` pinned). 20-concurrent inbound load spike test deferred from week 1 of v1.2 to a post-deploy canary in Phase 06 territory.
- Tracked but not formally in v1.2: SEC-ROTATE-01 (Clerk key rotation) — backlog in REQUIREMENTS.md; instructions in USER-ACTIONS.md Section A2.

## Session Continuity

Last session: 2026-05-16
Stopped at: All 6 v1.2 phases code-complete (16 commits on `main`). User-action manifest at `.planning/milestones/v1.2-two-sided-agent-mvp/USER-ACTIONS.md`. Next step is for the user to work through Sections A→D, then run the INTEG-01 smoke test (Section E).
Resume file: .planning/milestones/v1.2-two-sided-agent-mvp/USER-ACTIONS.md
