# InternJobs.ai

## What This Is

InternJobs.ai is a messaging-first internship product for students and startups. The public marketing site lives at `internjobs.ai`, while the authenticated app lives at `app.internjobs.ai` for LinkedIn signup, waitlist onboarding, messaging-channel pairing, durable phone-thread routing, and the student agent experience.

The product feels lightweight and natural: students join with LinkedIn, choose the channel they already use, and get useful internship texts without filling out another portal. Startups onboard through a separate, email-first surface and reach students through human-approved drafts written by an agent.

## Core Value

InternJobs.ai helps students and startups meet through natural messages, not resume piles or application black holes.

## Current Milestone: v1.5 — Workspace Integration Finish + Startup Pilot Go-Live

**Goal:** Finish the last WORKSPACE-TRUE-INTEGRATION pane (SMS/phone → Parrot) and take the startup pilot LIVE — execute the deferred-ops runbooks for the Startups web app (phase 28.5) and Telnyx SMS/Voice (phase 29), land the first real pilot install, and close the deferred Lakera fail-open + tier confirmation. Second milestone under RRR **team mode**; first to run on CH-01 per-phase submission markers + the `integration/**` ruleset, on `integration/v1.5` cut off `main`.

**Target features (focused scope, confirmed 2026-06-30):**

- **W1 — Workspace SMS/phone → Parrot** (team-workspace): wire the Workspace SMS + phone-call panes as thin entry points into ParrotAgent (Telnyx + Cloudflare Voice) — integrate the real backing service, no reinvented UX. Completes WORKSPACE-TRUE-INTEGRATION (Mail→Agent-Inbox shipped v1.4 phase 30; Chat→Mattermost shipped v1.4 phase 31).
- **S1 — Startups web app go-live** (team-cms): execute `PHASE-28.5-DEFERRED-OPS.md` (DNS, Email Routing domain verification, `STARTUPS_CLERK_*` secrets → Infisical, Clerk webhook) to bring `startups.internjobs.ai` + per-startup agent email live.
- **S2 — Telnyx SMS + Voice AI go-live** (team-cms): execute `PHASE-29-DEFERRED-OPS.md` (Telnyx signup + toll-free number + BRN + API key + Voice AI portal + R2 + KV + cron) to bring startup SMS + voice-intake onboarding live.
- **S3 — First live pilot install** (team-cms): STARTUP-PILOT-LIVE-01 — real founder installs MCP (or web onboard) and completes `me()` + `post_role` + `search` + `reply`; evidence in `PILOT-EVIDENCE.md`.
- **S4 — Lakera fail-open + tier confirm** (team-cms): LAKERA-VERIFY-LIVE-03 (deferred fail-open test) + tier/quota confirmation for pilot volume (`infra/LAKERA-PRICING.md`).

**Not in v1.5** (deferred / demand-gated):

- Startup channel adapters — Slack / Discord / Teams / email-initiated — light up when a pilot explicitly asks
- SEC-ROTATE-ALL — reopen when the first pilot user makes rotation concrete (near, but not gating go-live)
- Daily.co vanity domain, A2P 10DLC number migration, multi-member — scale/volume-gated

## Previous Milestone: v1.4 Pilot Readiness (shipped 2026-06-24)

**Goal achieved:** Closed v1.3's dangling work + Neon-exit + Workspace upgrades (phases 22–27), stood up the startup MCP/web/Telnyx foundation code-complete with ops deferred to v1.5 (phases 28–29), and — beyond the original roadmap — shipped the Workspace true-integration Mail pane (phase 30) and native Mattermost Chat client (phase 31, +10k LOC). First RRR team-mode milestone (team-cms + team-workspace); hardened the submission gate to enforced per-phase markers (CH-01).

## Earlier Milestone: v1.3 Pilot Hardening (shipped 2026-05-19)

**Goal achieved:** v1.2 made production-safe via 3 of 4 planned phases. Phase 21 explicitly skipped (sole-user). Phase 19 cron infrastructure shipped but functionally inert (closeTodoFact writer carried into v1.4 A1). Two large un-roadmapped initiatives also landed: Neon-exit migration (Mattermost + student DB → self-hosted Fly Postgres) and the agent-lift into Workspace.

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

**Two-Sided Agent MVP + Parrot Workspace (v1.2):**

- ✓ SMS-01: `SmsProvider` interface seam fronting the Spectrum/Photon path — v1.2
- ✓ STARTUP-01: Startup auth via dedicated Clerk app (workspace.internjobs.ai, phone-OTP-only) — v1.2
- ✓ STARTUP-02: Startup profile + founder identity + consent capture; `startups` and `startup_members` schema — v1.2
- ✓ ROLE-01: `roles` schema + in-app CRUD — v1.2
- ✓ EMAIL-01: Cloudflare Email Routing → Worker → Mastra ingest — v1.2
- ✓ EMAIL-02: Outbound transactional email via Cloudflare Email Service ("Agent Mail") — v1.2
- ✓ EMAIL-03: Per-conversation Reply-To aliases on `agent.internjobs.ai` subdomain (deterministic threading) — v1.2
- ✓ AGENT-01: Mastra agent core, student → match → draft → send loop (autonomous after 2026-05-17 pivot) — v1.2
- ✓ AGENT-02: Mastra thread memory keyed by `student_id` and `startup_id` — v1.2
- ✓ AGENT-03: pgvector semantic memory on Neon (`bge-base-en-v1.5`, 768-dim) — v1.2
- ✓ AGENT-VOICE: Llama 3.3 70B fp8-fast with explicit voice rules + few-shot exemplars — v1.2
- ✓ MEMORY-01: Self-hosted FalkorDB on Fly + Graphiti-style temporal facts (Node) — v1.2 (code shipped, runtime activation deferred to v1.3 PHASE14-RUNTIME)
- ✓ OPS-01: Read-only message audit log at `/ops/drafts` — v1.2
- ✓ OPS-02: Autonomous send with system-prompt guardrails + post-hoc flag-for-review — v1.2
- ✓ STORAGE-01: Private R2 bucket `internjobs-agent-store` with signed-URL-only access (scaffold; ingestion deferred to v1.3+ STORAGE-02) — v1.2
- ✓ INTEG-01: Two-sided autonomous smoke test (student SMS → agent → startup email → agent → student SMS) — v1.2
- ✓ PARROT-WORKSPACE: workspace.internjobs.ai with Slack-style UI, phone-OTP auth, three-tab Meetings pane, notification drawer + Web Push, OnboardingWizard — v1.2 (Phases 11–17)
- ✓ DASHBOARD-AGENT: kimi-k2.6 cross-channel todo extraction via Cloudflare AI Gateway with per-employee daily caps + prompt caching — v1.2
- ✓ IMESSAGE-BRIDGE: Self-hosted BlueBubbles on HostMyApple Mac mini + Cloudflare Tunnel (replaces Photon $250→$73/mo) — v1.2
- ✓ AGENTIC-INBOX: Maya identity mailbox MCP Worker at agent.internjobs.ai with R2 attachments + CF Access SSO — v1.2
- ✓ LINK-ENRICH-QR: Bright Data LinkedIn enrichment + Standout-style QR onboarding flow — v1.2
- ✓ DAILY-CO: Per-employee always-on personal rooms + ephemeral StartMeeting CTA — v1.2
- ✓ MATTERMOST-OIDC: Mattermost OIDC SSO bridge via Parrot `/oidc/*` endpoints — v1.2
- ✓ ADMIN-INVITE: Admin invite UX with capability toggles + phone-OTP + warm welcome email (Phase 16) — v1.2

**Pilot Hardening (v1.3) — moved to Validated:**

- ✓ PHASE14-RUNTIME: `internjobs-graph-api` Fly proxy + Workspace Worker `graph.ts` HTTP transport (Phase 18 commits `be38369`, `3449299`, `1664d67`, `1d13b1d`) — v1.3
- ✓ PARROT-AUTO-CLEAR (infrastructure only): DO migration 8 + `auto-clear.ts` cron + Resolved view + Undo + animate-out (Phase 19 commits `6415650`, `218d879`, `d03ff15`, `cdbc8ab`) — v1.3. **Caveat:** cron runs but finds nothing because no `closeTodoFact` writer exists; finished in v1.4 A1.
- ✓ SAFETY-01 (code only): Lakera screening helpers + insertion points + `safety_events` table + `/ops/safety` view (Phase 20 commits `fd24477`, `6f33854`, `30ca491`, `98cea02`) — v1.3. **Caveat:** Lakera v2 schema unverified + 3 verification tests not yet run; finished in v1.4 A2/A3.
- — SEC-ROTATE: deferred indefinitely (sole user) at user direction. RUNBOOK preserved at `.planning/milestones/v1.3-pilot-hardening/phases/21-credential-rotation/RUNBOOK.md`.

**Neon-exit (un-roadmapped, shipped 2026-05-21):**

- ✓ NEON-EXIT-MM: Mattermost DB migrated to self-hosted Fly Postgres `internjobs-mattermost-db` — commit `729832b`
- ✓ NEON-EXIT-STUDENT: Student app DB migrated to self-hosted Fly Postgres `internjobs-student-db` (pgvector + HNSW preserved) — commit `8983104`. Workspace Worker decoupled from Postgres via new student-app `/internal/safety-events` Bearer API (verification carried into v1.4 B1).

**v1.3.1 patches (rolled into v1.4 carry-forward):**

- Partial — Workspace agent-lift (AgentPanel, MCPPanel, EmailPanel, agent-tools, agent routes lifted from agentic-inbox into apps/parrot) — code-shipped, authenticated UAT pending (v1.4 A5)
- ✓ Chat/email native Workspace surfaces (commit `23b0e58`)
- ✓ Mattermost white-label proxy (commit `f7e4272`)
- ✓ LinkedIn URL invariant + Bright Data enrichment (commits `26ee577`, `b3e349d`, `930c758`, `46cbc25`, `c83098c`)

**v1.4 Pilot Readiness (shipped 2026-06-24) — moved to Validated:**

- ✓ Groups A–E — closeTodoFact writer, Lakera live-verified, attachment download, agent-lift UAT, Neon-exit closeout, Mattermost SSO, KGRAPH `:Employee` reuse, admin UX, GenZ polish, Daily.co theme, star API, shared-dates cleanup, Workspace Worker test floor (phases 22–27)
- ✓ Startup channel foundation (code-complete; ops → v1.5 S1–S2) — MCP server at `mcp.internjobs.ai` (phase 28), Startups web app + Clerk #3 + per-startup agent email (phase 28.5), Telnyx SMS + Voice AI code (phase 29)
- ✓ WORKSPACE-TRUE-INTEGRATION (partial) — Mail→Agent-Inbox pane (phase 30) + native Mattermost Chat client (phase 31); SMS/phone→Parrot → v1.5 W1
- ✓ CH-01 coordinator hardening — per-phase submission markers (`.planning/workstreams/<team>/submissions/<phase>.json`), landed on `main` pre-v1.5

### Active

<!-- Current scope for v1.5 — Workspace Integration Finish + Startup Pilot Go-Live. Two parallel tracks under RRR team mode on integration/v1.5 (per-phase markers, integration/** ruleset). -->

**Track W — Workspace true-integration finish (team-workspace):**

- [ ] **W1 WORKSPACE-SMS-PHONE-PARROT**: Wire the Workspace SMS + phone-call panes as thin entry points into ParrotAgent (Telnyx + Cloudflare Voice). Integrate the real backing service — no reinvented UX (per the WORKSPACE-TRUE-INTEGRATION directive). Completes the tripod: Mail→Agent-Inbox (phase 30) + Chat→Mattermost (phase 31) already shipped. **Team: team-workspace**

**Track S — Startup pilot go-live (team-cms):**

- [ ] **S1 STARTUP-28.5-OPS-LIVE**: Execute `PHASE-28.5-DEFERRED-OPS.md` (12 steps: DNS, Email Routing domain verification, `wrangler secret put STARTUPS_CLERK_*` → Infisical, Clerk webhook) to bring `startups.internjobs.ai` + per-startup agent email live. **Team: team-cms**
- [ ] **S2 STARTUP-29-OPS-LIVE**: Execute `PHASE-29-DEFERRED-OPS.md` (22 steps: Telnyx signup + toll-free number + BRN + API key + Voice AI portal config + R2 bucket + KV namespace + cron deploy) to bring startup SMS + voice-intake onboarding live. **Team: team-cms**
- [ ] **S3 STARTUP-PILOT-LIVE-01**: First real founder installs MCP (or web-onboards) and completes `me()` + `execute('post_role')` + `search('candidates')` + `execute('reply_to_candidate')`; record tool-call evidence in `PILOT-EVIDENCE.md`. **Team: team-cms** (Ridhi concierge)
- [ ] **S4 LAKERA-VERIFY-LIVE-03 + TIER-CONFIRM**: Run the deferred Lakera fail-open test (if pilot-critical) + confirm tier/quota sufficient for pilot volume (`infra/LAKERA-PRICING.md`). **Team: team-cms**

### Out of Scope

- **LinkedIn credential capture or login scraping** — high legal/security risk and unnecessary; use Clerk OAuth, official/user-authorized data, and explicit consent gates.
- **Automated private LinkedIn scraping** — likely violates platform expectations; only after legal review and approved API/provider path.
- **Replacing the marketing site with the app** — marketing remains a static Cloudflare Pages deployment.
- **ATS or recruiter dashboard** — wrong product feel; the app stays messaging-first and lightweight.
- **Telnyx activation in v1.3** — A2P 10DLC registration takes weeks and pivots on an external timeline. Held for v1.4 as a drop-in adapter behind the existing `SmsProvider` seam.
- **Cognee activation in v1.3** — placeholder rows from v1.1 remain durable but inert. Still gated on legal approval.
- **Sprite.dev + Bright Data activation in v1.3** — placeholders stay inert until legal/compliance approval.
- **Storage ingest, short links, vanity email, Daily.co vanity domain in v1.3** — STORAGE-02, STORAGE-03, EMAIL-04, DAILY-VANITY-01 are pilot polish; can ship as v1.3 patches if a pilot startup needs one, otherwise v1.4.
- **Voice (any provider)** — demand-gated on >10% inbound asks for voice.
- **Slack integration for startups** — demand-gated on first 5-10 startups indicating Slack > email.
- **2nd SMS number for startup SMS** — demand-gated on startup feedback that email isn't enough.
- **Feedback loop, thread summarizer, multi-member invites, inference consent toggle** — depth/hygiene work for v1.4+; doesn't block pilot.

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
- **Safety (post-2026-05-17 autonomy pivot)**: The agent has system-prompt-level guardrails (no legal/financial promises, no PII about other parties, polite refusal of illegal asks). Lakera Guard pre-LLM screening is planned for v1.3 (SAFETY-01). Every sent message is logged in `/ops/drafts`; operators can flag any message post-hoc for prompt-tuning review. Pre-pivot posture ("no auto-send, every outbound human-approved") is HISTORICAL.
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
| Per-conversation email aliases (`conv-{conversation_id}@agent.internjobs.ai`) as the primary inbound startup identification path (EMAIL-03) | Deterministic threading; eliminates fragile from-address lookup; reuses the existing Phase 03 catch-all Worker rule (re-bound to the subdomain) with zero schema cost (lives in `inbound_messages.metadata` jsonb); legacy From-address lookup stays as fallback | — Pending v1.2 execution |
| Agent email aliases isolated to `agent.internjobs.ai` subdomain (not the apex) | Keep `internjobs.ai` apex free for employee/human email routing (e.g., `raj@`, `support@`); hard separation prevents Worker from being a fallback for human typos. CF Email Routing has supported subdomains since Oct 2025, so the subdomain catch-all gives full isolation without extra cost. Apex catch-all forwards to the operator's personal inbox; if a startup strips the subdomain in a reply, it lands in the human inbox (not the agent) and the operator handles it manually — explicit hard cut-over, no transitional apex fallback. | ✓ Shipped 2026-05-16 |
| Direct Workers AI REST from Fly (no proxy Worker, no AI Gateway intermediary in v1.2) | User-provided CF API token has Workers AI scope, so the Fly Node app can call `api.cloudflare.com/client/v4/accounts/{id}/ai/run/...` directly with `Authorization: Bearer`. One less moving part than a proxy Worker — no wrangler deploy, no shared-secret rotation, no extra hop. Embeddings use `@cf/baai/bge-base-en-v1.5` (768-dim) and chat uses `@cf/meta/llama-3.1-8b-instruct`. AI Gateway can be added later by changing the URL prefix to `/v1/{account_id}/{gateway_id}/workers-ai/...` without touching the response-shape parsing. | ✓ Shipped 2026-05-16 — direct REST, replaces the prior proxy Worker (torn out same day) |
| `@clerk/backend.authenticateRequest()` for prod auth (replaces home-rolled JWKS-only verifier) | The Clerk production custom-domain flow (clerk.internjobs.ai + accounts.internjobs.ai → app.internjobs.ai) issues a `__clerk_handshake` URL parameter on the first cross-subdomain redirect after sign-in. A JWKS-only verifier sees no session cookie on that hop and 302s back to sign-in, producing an auth loop. The SDK's `authenticateRequest()` handles the full state machine: cookie + handshake-param + signed-out + signed-in. The dev paths (signed cookie + header-dev) short-circuit before the SDK is touched, so smoke tests still run without CLERK_* envs. Singleton SDK client (lazy on first prod-auth request); pinned `@clerk/backend@3.4.9` exact. | ✓ Shipped 2026-05-16 — fixed a live prod auth loop after LinkedIn sign-in |
| **2026-05-17 pivot: autonomous agent (no operator approval gate)** | Human-in-the-loop made conversational UX impossibly slow — turn-by-turn approval latency would feel non-conversational. The agent now drafts AND sends on both student SMS and startup email channels without human pre-send review. `/ops/drafts` becomes a READ-ONLY audit log (every sent message + every inbound is logged). Operator can flag a sent message for prompt-tuning review post-hoc but cannot approve/edit/reject pre-send. Risk acknowledged: agent can say bad things. Mitigated by (1) system-prompt-level safety guardrails (no legal/financial promises, no PII about other parties, polite refusal of illegal asks), (2) operator flag-for-review post-hoc, (3) Lakera Guard pre-LLM screening planned for v1.3 (SAFETY-01). | ✓ Shipped 2026-05-17 — commits `d8a0bb3` (AGENT-AUTO) + `57e3320` (OPS-AUDIT) |
| **2026-05-17: agent model upgraded to Llama 3.3 70B (fp8-fast) + voice tuned via few-shot exemplars (AGENT-VOICE)** | The 8B model produced generic, customer-service-flavored SMS that read like an autoresponder ("Hi! Thanks for reaching out — I'd love to chat about the role.") — wrong tone for the autonomous-send posture. Bumped chat model from `@cf/meta/llama-3.1-8b-instruct` → `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (fp8-fast is the cost-optimized 70B variant on Workers AI: 8-bit quantized, fast-path inference). System prompt rewritten with explicit voice rules (lowercase except proper nouns, hyphen-break " - " clauses, no emojis, first-person, push back when wrong, name actual roles/companies/schools) and 5 few-shot exemplars lifted from a competitor's recruiting-agent SMS thread. `max_tokens` 512 → 800, `temperature` 0.7 → 0.5 (tighter style adherence). `student_profile_context` now also pulls `students.name` + latest `profile_snapshots.display_name` so the agent has the candidate's first name. New exports: `AGENT_VOICE`, `AGENT_VOICE_EXEMPLARS`, `AGENT_SYSTEM_PROMPT` (composed: persona + voice + exemplars + safety). Embedding model untouched — stays `@cf/baai/bge-base-en-v1.5` (768-dim, pgvector tables locked). Live-probed reachable on this account; fallback chain documented in code (fp8-fast → `@cf/meta/llama-3.1-70b-instruct` if catalog drops; non-fast 3.3 returned "No route" and is NOT a fallback). Phase B (v1.3+) will add Graphiti+FalkorDB graph memory; Phase A is last-N-messages context via the existing thread history slot. | ✓ Shipped 2026-05-17 |
| **2026-05-17 Phase B: graph memory via self-hosted FalkorDB on Fly + Graphiti-style temporal fact model in Node (MEMORY-01)** | Cross-conversation, multi-day recall is what makes the agent personality feel real ("hey raj. been a minute - how'd the valon thing land?"). User picked FalkorDB + Graphiti specifically so we can SELF-HOST (no vendor lock-in, no per-month managed service). Graphiti's official lib is Python; we deliberately did NOT introduce a Python sidecar — we wrote a thin Node implementation of the same temporal-fact pattern at `apps/app/src/memory/graph.mjs` against FalkorDB's Cypher API (`falkordb@6.6.2` npm client, Redis wire protocol). New Fly app `internjobs-graph` in `internjobs-sios-org` region `ord` — internal-only at `internjobs-graph.internal:6379` (no public IP), 10GB volume + AOF persistence, password auth via Fly secret + Infisical. Custom Dockerfile + entrypoint.sh wrap the official `falkordb/falkordb:latest` image because the upstream `run.sh`'s `${REDIS_ARGS}` expansion path didn't survive Fly's secret-injection prefix layer (two failure modes documented in the Dockerfile comments). Workflow integration: pre-LLM `getStudentSummary(studentId)` injection as the FIRST block of the per-turn user prompt + fire-and-forget post-reply fact extraction via Workers AI 70B (temperature 0.1, JSON-only). Fail-soft end-to-end: app boots without FALKORDB_URL, workflow completes the turn without graph (degraded UX, no cross-conversation recall). New /healthz key `graphReady` (cached 30s). Verified live: graphReady=true on production student app post-deploy. | ✓ Shipped 2026-05-17 |

---
*Last updated: 2026-06-30 — v1.5 milestone started (focused scope: W1 Workspace SMS/phone→Parrot + S1–S4 startup pilot go-live; demand-gated adapters + SEC-ROTATE deferred). v1.4 Pilot Readiness shipped 2026-06-24 — phases 22–31 (incl. un-roadmapped phase 30 Mail-pane + phase 31 native Mattermost chat, +10k LOC) + CH-01 per-phase submission markers landed on `main`; v1.4 Active Groups A–E + startup foundation moved to Validated. Previously 2026-05-24 — v1.4 Pilot Readiness milestone started. v1.3 (Pilot Hardening) marked shipped: PHASE14-RUNTIME ✓, PARROT-AUTO-CLEAR ✓ (infra only — closeTodoFact writer carried into v1.4 A1), SAFETY-01 ✓ (code only — verification carried into v1.4 A2/A3), SEC-ROTATE deferred (sole user). Neon-exit (un-roadmapped, 2026-05-21) added to Validated: NEON-EXIT-MM + NEON-EXIT-STUDENT. v1.3.1 partial-ships logged. v1.4 Active: 14 items in Groups A (5 v1.3 closeouts), B (3 Neon-exit closeout), C (4 carryovers + Workspace upgrades), D (3 polish), E (1 test floor) — each assigned to team-cms or team-workspace. First milestone under RRR team mode (initialized 2026-05-24 via `/rrr:team-init`; team-cms owns Marketing CMS + Student app, team-workspace owns Workspace app). Previously 2026-05-19 — v1.3 Pilot Hardening milestone started; v1.2 items moved to Validated (24 line items including Workspace, Dashboard Agent, FalkorDB MEMORY-01, iMessage Bridge, Agentic Inbox, LinkedIn Enrichment+QR, Daily.co, Mattermost OIDC, Admin Invite). Active reset to 4 items: PHASE14-RUNTIME (FalkorDB bridge — Fly REST proxy vs Workers RESP3 client to be resolved in milestone research), PARROT-AUTO-CLEAR (Graphiti `valid_to` close-out, Phase 14-dependent), SAFETY-01 (Lakera Guard pre-LLM screening), SEC-ROTATE (Clerk + CF Email + CF AI + broad CF API tokens). Out of Scope updated: Telnyx pushed to v1.4 (A2P 10DLC), STORAGE-02/03/EMAIL-04/DAILY-VANITY-01 demoted to pilot patches, Cognee/Sprite/Bright Data still legal-gated, voice/Slack/2nd SMS demand-gated. Previously 2026-05-17 — MEMORY-01 (Phase B): self-hosted FalkorDB on Fly + Graphiti-style temporal fact model in Node shipped. New Fly app `internjobs-graph` (internal-only Redis-protocol graph DB + Cypher, 10GB AOF volume). Custom Dockerfile + entrypoint.sh fix a password-injection bug in the upstream image's `${REDIS_ARGS}` expansion. Native Node implementation at `apps/app/src/memory/graph.mjs` (no Python sidecar). Workflow injects `getStudentSummary` pre-LLM + runs fire-and-forget post-reply fact extraction via Workers AI 70B. `/healthz` adds `graphReady` (cached 30s). Live-verified graphReady=true on production. Earlier 2026-05-17 — AGENT-VOICE: agent model upgraded `@cf/meta/llama-3.1-8b-instruct` → `@cf/meta/llama-3.3-70b-instruct-fp8-fast` for conversational quality. System prompt rewritten with explicit voice rules (lowercase, hyphen-break, no emojis, push back, first person, name actual roles/companies/schools) + 5 few-shot exemplars from a competitor's recruiting-agent SMS thread. New exports: `AGENT_VOICE`, `AGENT_VOICE_EXEMPLARS`, `AGENT_SYSTEM_PROMPT`. `loadStudentProfile` now also returns first_name (derived from `students.name` or latest `profile_snapshots.display_name`). max_tokens 512 → 800, temperature 0.7 → 0.5. Embedding model untouched (`bge-base-en-v1.5`, 768-dim). Earlier 2026-05-17 — AUTONOMY PIVOT (AGENT-AUTO + OPS-AUDIT): removed the v1.2 operator approval gate. Mastra workflow now auto-sends agent responses on both student SMS and (future) startup email channels without human approval. APPROVE-01/02 reframed as OPS-01/02 (read-only audit log + flag-for-review). "Auto-send of agent-drafted messages" line removed from Out of Scope. Constraints "No auto-send" line replaced with system-prompt guardrails + v1.3 Lakera Guard. /ops/drafts becomes a read-only audit log; /ops/feedback now lists flagged messages (not approve/reject). Commits `d8a0bb3` + `57e3320`. Earlier 2026-05-16 — AUTH-PROD: switched `apps/app/src/auth.mjs::getAuth()` to `@clerk/backend@3.4.9 authenticateRequest()` to fix a live prod auth loop (the home-rolled JWKS verifier couldn't exchange Clerk's `__clerk_handshake` URL param for a session). New `applyHandshakeOrContinue` helper forwards SDK headers + 307 at every getAuth callsite. Dev paths preserved. Earlier 2026-05-16: EMAIL-03 subdomain isolation (agent aliases moved from apex to `agent.internjobs.ai` subdomain, hard cut-over). Earlier 2026-05-16: Workers AI direct tear-out (proxy Worker `apps/ai-worker/` removed; Fly Node app now calls `api.cloudflare.com/.../ai/run/...` directly with `CLOUDFLARE_AI_API_TOKEN`; `/healthz` drops `aiProxyReady` and adds `workersAiReady`). Earlier 2026-05-16: Workers AI swap (OpenAI → Cloudflare Workers AI via the internjobs-ai-proxy Worker; embedding column `vector(1536)` → `vector(768)` via migration 0005; openai npm dep removed). Earlier 2026-05-16: STORAGE-01 + EMAIL-03 scope-add (private R2 bucket scaffold with per-entity folders + per-conversation Reply-To aliases for deterministic threading; modeled on SuperIntelligence patterns). Prior 2026-05-16 update: Resend → Cloudflare Email Service swap for EMAIL-02 outbound (already on CF DNS, one less vendor; CF "Agent Mail" public beta 2026-04-17). 2026-05-15 update: v1.1 completion and v1.2 scope revision (Telnyx held for v1.3, Spectrum stays active behind `SmsProvider` seam).*
