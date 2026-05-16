# Project Milestones: InternJobs.ai

## v1.1 Seamless Waitlist and Student Threading (Shipped: 2026-05-15)

**Delivered:** Students sign in with LinkedIn, land directly on QR/SMS pairing, verify with an 8-character code via the shared Spectrum number, and have all follow-up texts routed back to their thread — with durable handoff placeholders for Cognee graph memory and Sprite/Bright Data enrichment.

**Phases completed:** 7 (1 phase incremental over v1.0, 1 plan)

**Key accomplishments:**

- Moved Fly app to `internjobs-sios-org` and shipped v1.1 to production at `app.internjobs.ai`.
- Routed signed-in students directly to pairing; added confirmed-state UI after phone verification.
- Generated an 8-character pairing code and the exact verification SMS copy: `Hey internjobs.ai! My verification code is {CODE}. What's next?`
- Added normalized phone-number routing so any follow-up text to the shared Spectrum number attaches to the correct student thread (THREAD-01).
- Added `student_threads` placeholders for Cognee hosted graph/thread handoff and `profile_enrichment_jobs` placeholders for Sprite.dev + Bright Data — durable records without unapproved enrichment.
- Activated Clerk production LinkedIn provider, stored prod keys in Infisical (`prod`/`internjobs-ai`), imported into Fly via `flyctl secrets import`, applied migrations `0001`/`0002`, and verified `/healthz` + `/config/status` green over HTTPS.

**Stats:**

- 1 phase (Phase 7), 1 plan, 6 requirements satisfied (WAIT-01/02/03, THREAD-01, GRAPH-01, ENRICH-01)
- AUTH-01 (Clerk LinkedIn production) also activated as part of the v1.1 deploy session
- Timeline: 2026-05-09 (plan) → 2026-05-15 (prod activation)
- Git range: `9ee3657` → `fd004a7` (+ Dockerfile fix shipped in v1.1 archive commit)

**Audit:** `gaps_found` (procedural — see `.planning/milestones/v1.1-seamless-waitlist/MILESTONE-AUDIT.md`). All 6 requirements verified in code and at runtime; no RRR `VERIFICATION.md` artifacts exist because phases were executed outside the RRR plan/verify chain.

**Known carry-over to v1.2:**

- Live LinkedIn → Clerk → app sign-in not yet exercised end-to-end against prod Clerk; blocked by Cloudflare DNS proxy on `accounts.internjobs.ai` and `clerk.internjobs.ai` (should be DNS-only).
- `CLERK_SECRET_KEY` rotation pending (value was pasted in chat 2026-05-15); user accepted residual risk.
- Cognee + Sprite/Bright Data placeholders intentionally inert until compliance review.

**What's next:** v1.2 — Two-Sided Agent MVP (Telnyx student SMS in parallel with Spectrum, Mastra agent core with thread + pgvector memory, Cloudflare Email Routing for startup inbound, startup onboarding + roles model, operator approval gate UI).

---

## v1.0 Waitlist Identity and Messaging Foundation (Shipped: 2026-05-09)

**Delivered:** Public marketing site at `internjobs.ai` plus a deployable authenticated app at `app.internjobs.ai` with Clerk identity, Neon data, Photon/Spectrum channel pairing, LinkedIn profile ingestion, and launch guardrails.

**Phases completed:** 1-6 (15 plans total)

**Key accomplishments:**

- Split the repo into `apps/marketing` (Cloudflare Pages) and `apps/app` (Fly.io) workspaces with shared contracts.
- Wired Clerk-first identity, app middleware/session handling, and the student waitlist onboarding flow.
- Built the Neon data foundation: migrations for students, waitlist state, channel pairing, consents, profile snapshots, audit events, plus an idempotent data-access layer.
- Implemented Photon/Spectrum pairing: unique code generation, QR/code screen, inbound webhook with signature validation, and welcome-message dispatch.
- Built LinkedIn profile ingestion through Clerk/OAuth with student review/correction UI; documented the browser-enrichment compliance gate.
- Added launch guardrails: Fly health checks, webhook security, log hygiene, privacy/delete/export documentation, deploy scripts, and asset verification.

**Stats:**

- 6 phases, 15 plans, 25 requirements complete (1 pending external activation carried into v1.1)
- Timeline: project start → 2026-05-09

**What's next:** v1.1 Seamless Waitlist and Student Threading (above).

---

*For current project status, see `.planning/ROADMAP.md`. For full per-milestone detail, see `.planning/milestones/`.*
