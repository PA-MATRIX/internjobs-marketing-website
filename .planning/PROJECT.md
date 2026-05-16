# InternJobs.ai

## What This Is

InternJobs.ai is a messaging-first internship product for students and startups. The public marketing site lives at `internjobs.ai`, while the authenticated app lives at `app.internjobs.ai` for LinkedIn signup, waitlist onboarding, messaging-channel pairing, durable phone-thread routing, and the student agent experience.

The product feels lightweight and natural: students join with LinkedIn, choose the channel they already use, and get useful internship texts without filling out another portal. Startups onboard through a separate, email-first surface and reach students through human-approved drafts written by an agent.

## Core Value

InternJobs.ai helps students and startups meet through natural messages, not resume piles or application black holes.

## Requirements

### Validated

<!-- Shipped and confirmed in production. -->

**Marketing foundation (v1.0):**

- ✓ MKT-01: Public student landing at `/` — v1.0
- ✓ MKT-02: Public startup page at `/startups` — v1.0
- ✓ LEGAL-01: Privacy page at `/privacy` — v1.0
- ✓ LEGAL-02: Terms page at `/terms` — v1.0
- ✓ DEPLOY-01: Marketing deploy verifies production CSS/JS — v1.0

**Architecture and identity (v1.0):**

- ✓ ARCH-01..04: Separately deployable `apps/marketing` + `apps/app` workspaces with shared contracts — v1.0
- ✓ AUTH-01..04: Clerk-first LinkedIn auth, no email/password in student waitlist, post-auth lands on pairing, Clerk user ID stored in Neon — v1.0 (AUTH-01 prod-activated 2026-05-15 during v1.1 deploy)

**Data and messaging (v1.0):**

- ✓ DATA-01..04: Neon schema for students/waitlist/pairing/profiles/consents/audit, repeatable migrations, Infisical-managed secrets, idempotent writes — v1.0
- ✓ MSG-01..05: Pairing codes, QR/code screen, Photon/Spectrum inbound webhook, welcome message, delivery state tracking — v1.0

**LinkedIn ingestion and operations (v1.0):**

- ✓ LINK-01..04: Clerk/OAuth-authorized profile storage, explicit enrichment consent, browser-enrichment gated behind compliance design, student review/correction UI — v1.0
- ✓ OPS-01..04: Fly health checks, webhook signature validation, no sensitive-data logging, documented privacy/delete/export paths — v1.0

**Seamless waitlist and threading (v1.1):**

- ✓ WAIT-01: Authenticated users land directly on QR/SMS pairing — v1.1
- ✓ WAIT-02: QR opens the exact verification text `Hey internjobs.ai! My verification code is {CODE}. What's next?` — v1.1
- ✓ WAIT-03: 8-character pairing code is short, unique, and textable — v1.1
- ✓ THREAD-01: Follow-up texts from the same phone attach to the verified student via normalized phone-number routing — v1.1
- ✓ GRAPH-01: Durable `student_threads` placeholder records created for Cognee hosted handoff (no provider call) — v1.1
- ✓ ENRICH-01: Durable `profile_enrichment_jobs` placeholder records created for Sprite.dev + Bright Data handoff (no provider call) — v1.1

### Active

<!-- Current scope for v1.2 — Two-Sided Agent MVP. Student SMS stays on Spectrum/Photon (v1.1 implementation). -->

- [ ] **SMS-01**: Refactor the existing Spectrum/Photon send/receive path behind an `SmsProvider` interface so a Telnyx (or other) adapter can drop in later without touching call-sites. v1.2 ships one implementation (Spectrum).
- [ ] **STARTUP-01**: New startup auth flow (Clerk, email-first or Google/Microsoft — *not* LinkedIn-required).
- [ ] **STARTUP-02**: Startup profile + founder identity + consent capture, with schema for `startups` and `startup_members`.
- [ ] **ROLE-01**: New `roles` schema (`startup_id`, `title`, `description`, `requirements`, `status`, `location`, `comp_range`, `created_at`) with simple in-app CRUD.
- [ ] **EMAIL-01**: Cloudflare Email Routing on `internjobs.ai` for startup-facing addresses; Worker validates and forwards to a Mastra ingest endpoint.
- [ ] **EMAIL-02**: Outbound transactional email via Cloudflare Email Service ("Agent Mail", public beta 2026-04-17) for sending agent drafts to startups. CF Email Routing handles inbound; CF Email Service handles outbound — same vendor.
- [ ] **AGENT-01**: Mastra agent core with workflows for the student → match → draft → approve → send loop.
- [ ] **AGENT-02**: Mastra thread memory keyed by `student_id` and separately by `startup_id` for full conversation history.
- [ ] **AGENT-03**: pgvector semantic memory on Neon for long-term cross-conversation recall.
- [ ] **APPROVE-01**: Human-in-the-loop operator dashboard lists agent-produced drafts (student-side SMS replies + startup-side emails) for approve/edit/reject.
- [ ] **APPROVE-02**: No auto-send in v1.2 — every outbound message is human-approved; rejected drafts feed back into a training/feedback log.
- [ ] **EMAIL-03**: Per-conversation Reply-To aliases (`conv-{conversation_id}@internjobs.ai`) for deterministic inbound startup threading. Catch-all Worker parses the `conv-` prefix; Fly writes the UUID into `inbound_messages.metadata.conversation_id`. Replaces From-address lookup as the primary path.
- [ ] **STORAGE-01**: R2 storage scaffold — private bucket `internjobs-agent-store`, per-entity folder convention, signed-URL-only sharing (Mala posture). Client at `apps/app/src/storage/r2.mjs` fails soft when envs unset. NO ingestion wired (deferred to v1.3 STORAGE-02).
- [ ] **INTEG-01**: Two-sided smoke test — student inbound (Spectrum) → agent draft → operator approve → startup email send → startup reply → agent draft → operator approve → student SMS (Spectrum).

### Out of Scope

- **LinkedIn credential capture or login scraping** — high legal/security risk and unnecessary; use Clerk OAuth, official/user-authorized data, and explicit consent gates.
- **Automated private LinkedIn scraping** — likely violates platform expectations; only after legal review and approved API/provider path.
- **Replacing the marketing site with the app** — marketing remains a static Cloudflare Pages deployment.
- **ATS or recruiter dashboard** — wrong product feel; the app stays messaging-first and lightweight.
- **Auto-send of agent-drafted messages** — breaks the product promise and legal posture; every outbound message is human-approved in v1.2.
- **Cognee in v1.2** — agent memory lives in Mastra thread + pgvector. Cognee placeholders from v1.1 stay durable but inert. Revisit in v1.3+ only if matching quality plateaus.
- **Telnyx activation in v1.2** — v1.2 ships only the `SmsProvider` interface seam (SMS-01). The existing Spectrum/Photon path stays the sole active SMS implementation. Telnyx provisioning, A2P 10DLC registration, soft cutover state machine, and migration SMS are all held for v1.3+ as a drop-in adapter.
- **Voice (any provider)** — held for v1.3, gated on >10% inbound asks for voice.
- **Slack integration for startups** — held for v1.3, gated on first 5-10 startups indicating Slack > email.
- **2nd SMS number for startup SMS** — held for v1.3, gated on startup feedback that email isn't enough.
- **Sprite.dev + Bright Data browser enrichment activation** — placeholders from v1.1 stay inert until legal/compliance approval.

## Context

- Repo is a monorepo: `apps/marketing` (Cloudflare Pages, `internjobs.ai`), `apps/app` (Fly.io as `internjobs-ai-student-app` under `internjobs-sios-org`, `app.internjobs.ai`), `packages/shared` for contracts.
- Clerk account `rraj@growthpods.io`; production app `Internjobs.ai` (`app_38BrRDRKnvbo7vlE2ZZtMc7hFPC`); prod LinkedIn provider live since 2026-05-15.
- Neon is system of record. Migrations `0001_waitlist_foundation` and `0002_waitlist_threads_and_enrichment` applied in prod. Schema includes `students`, `pairing_codes`, `student_threads`, `profile_enrichment_jobs`, `consents`, and audit events.
- v1.1 shipped 2026-05-15; `/healthz` reports `clerk/database/photonNumber/photonWebhook/spectrumListener` all `true`; `/config/status` returns `{"missing":[]}`.
- Photon/Spectrum is the active student SMS path (shared number with normalized phone-thread routing) and stays so through v1.2. v1.2 wraps it in an `SmsProvider` interface so v1.3+ can swap in Telnyx as a drop-in adapter.
- Infisical is the source of truth for secrets: project `26995afd-9a6f-4690-912f-01cbcebb76d5`, org `2c12f042-e98f-4fb3-8b40-16aec29f9b91`, env `prod`, path `/internjobs-ai`. The older `0484b3ce` Infisical project is dead.
- v1.2 introduces a second user type (startups) and an operator user type (approval dashboard) — two new identity flows and two new UX surfaces.
- Carry-over from v1.1: live LinkedIn → Clerk → app sign-in not exercised end-to-end against prod Clerk; blocked by Cloudflare DNS proxy on `accounts.internjobs.ai` and `clerk.internjobs.ai` (should be DNS-only). Resolve before v1.2 execution.
- Mastra is young; verify production-readiness at expected message volume before week 2 of v1.2 execution. Fallback is a custom workflow layer on top of Neon.

## Constraints

- **Hosting**: Marketing on Cloudflare Pages; authenticated app on Fly.io (`internjobs-sios-org` / `internjobs-ai-student-app`).
- **Identity (students)**: LinkedIn-first through Clerk.
- **Identity (startups, v1.2)**: Email-first or Google/Microsoft through Clerk — *not* LinkedIn-required.
- **Database**: Neon Postgres is the primary application database; pgvector hosts agent semantic memory.
- **Agent framework (v1.2)**: Mastra owns workflows + thread memory + vector memory orchestration. Cognee is out for v1.2.
- **Messaging (students)**: Spectrum/Photon stays the active SMS path through v1.2, behind a new `SmsProvider` interface that v1.3+ can swap (e.g., Telnyx adapter) without touching call-sites.
- **Messaging (startups, v1.2)**: Cloudflare Email Routing → Worker → Mastra ingest for inbound. Outbound via Cloudflare Email Service ("Agent Mail", public beta 2026-04-17) — same vendor as inbound. Hard prereq: `internjobs.ai` is on Cloudflare DNS.
- **Safety**: No auto-send. Every outbound message in v1.2 goes through the operator approval gate.
- **Compliance**: LinkedIn data collection must be user-authorized — no credential capture, anti-bot bypass, or private-surface scraping. Sprite.dev + Bright Data placeholders stay inert.
- **Secrets**: Provider secrets live in Infisical, not repo files or plain local notes; never print secret values into chat, logs, or docs.
- **UX**: Students should not feel like they are filling out recruiting software.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Monorepo with `apps/marketing` and `apps/app` | Separate deployments without splitting shared auth, database, and messaging contracts | ✓ Good — shipped through v1.1 |
| Deploy public site through Cloudflare Pages | Existing production path already works with asset guardrails | ✓ Good |
| Deploy authenticated app through Fly.io | App needs server-side integrations, webhooks, background work, future browser/cloud tasks | ✓ Good |
| Use Clerk LinkedIn OAuth as the first identity step for students | Natural signup, avoids password/email-first onboarding | ✓ Good — prod-activated 2026-05-15 |
| Use `internjobs-sios-org` Fly org | Product runtime should live in the customer-specific SIOS org | ✓ Good |
| Use Neon Postgres as the system of record | Fits server app + durable profile/waitlist/event data + pgvector for v1.2 agent memory | ✓ Good |
| Use Infisical `prod`/`/internjobs-ai` (project `26995afd`) as the sole secret source | One source of truth across Clerk, LinkedIn OAuth, Neon, Photon/Spectrum, Telnyx (v1.2), Fly runtime | ✓ Good |
| Keep Cognee + Sprite/Bright Data as durable placeholder rows | Write the data shape now, light up provider calls behind a compliance gate later | ✓ Good — v1.1 shipped placeholders; Cognee deferred to v1.3+ |
| Normalize phone-number routing on a single shared Spectrum number | Lets the v1.1 single-number model thread correctly without dedicating a number per student | ✓ Good — v1.1 verified |
| Keep Spectrum/Photon as the active v1.2 SMS path; ship only an `SmsProvider` interface seam for future swap | Avoid stacking an unfamiliar SMS platform on top of an unfamiliar agent framework in one milestone; v1.1 implementation is verified in prod; Telnyx work moves to v1.3 once Mastra + operator gate are proven | — Pending v1.2 execution |
| Mastra for agent core, Cognee out for v1.2 | Single coherent agent framework with thread + pgvector memory keeps v1.2 scope tight; revisit Cognee only if matching quality plateaus | — Pending v1.2 execution |
| Cloudflare Email Routing → Worker → Mastra for startup inbound | Email is the primary startup channel; Worker validation keeps the Fly app loosely coupled to inbound | — Pending v1.2 execution |
| Cloudflare Email Service for outbound (public beta as of 2026-04-17) | Already on Cloudflare DNS (hard prereq); already using CF Email Routing for inbound; one less vendor to operate; native agent-targeted product launched at Agents Week 2026 | — Code shipped 2026-05-16; pending CF dashboard onboarding |
| Operator approval gate; no auto-send in v1.2 | Safety + learning constraint while agent quality is unproven; rejected drafts feed back into training | — Pending v1.2 execution |
| R2 storage scaffold in v1.2: per-entity folders inside one private bucket (`internjobs-agent-store`), signed-URL-only access (STORAGE-01) | Matches SuperIntelligence's Mala-aligned auditability posture (every share is time-bounded + signed); row-level partition via student_id/startup_id is sufficient for InternJobs (no per-user Postgres schema like SuperIntelligence — too heavyweight for this volume) | — Pending v1.2 execution |
| Per-conversation email aliases (`conv-{conversation_id}@internjobs.ai`) as the primary inbound startup identification path (EMAIL-03) | Deterministic threading; eliminates fragile from-address lookup; reuses the existing Phase 03 catch-all Worker rule with zero schema cost (lives in `inbound_messages.metadata` jsonb); legacy From-address lookup stays as fallback | — Pending v1.2 execution |

---
*Last updated: 2026-05-16 — STORAGE-01 + EMAIL-03 scope-add (private R2 bucket scaffold with per-entity folders + per-conversation Reply-To aliases for deterministic threading; modeled on SuperIntelligence patterns). Prior 2026-05-16 update: Resend → Cloudflare Email Service swap for EMAIL-02 outbound (already on CF DNS, one less vendor; CF "Agent Mail" public beta 2026-04-17). 2026-05-15 update: v1.1 completion and v1.2 scope revision (Telnyx held for v1.3, Spectrum stays active behind `SmsProvider` seam).*
