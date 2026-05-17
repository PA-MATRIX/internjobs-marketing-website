# Requirements: InternJobs.ai

**Defined:** 2026-05-16
**Core Value:** InternJobs.ai helps students and startups meet through natural messages, not resume piles or application black holes.
**Current Milestone:** v1.2 — Two-Sided Agent MVP

## Validated

Shipped and verified in production. Immutable.

### v1.0 — Waitlist App

**Marketing foundation:**

- [x] **MKT-01**: Public student landing at `/` — *verified v1.0*
- [x] **MKT-02**: Public startup page at `/startups` — *verified v1.0*
- [x] **LEGAL-01**: Privacy page at `/privacy` — *verified v1.0*
- [x] **LEGAL-02**: Terms page at `/terms` — *verified v1.0*
- [x] **DEPLOY-01**: Marketing deploy verifies production CSS/JS — *verified v1.0*

**Architecture and identity:**

- [x] **ARCH-01..04**: Separately deployable `apps/marketing` + `apps/app` workspaces with shared contracts — *verified v1.0*
- [x] **AUTH-01..04**: Clerk-first LinkedIn auth, no email/password in student waitlist, post-auth lands on pairing, Clerk user ID stored in Neon — *verified v1.0 (AUTH-01 prod-activated 2026-05-15 during v1.1 deploy)*

**Data and messaging:**

- [x] **DATA-01..04**: Neon schema for students/waitlist/pairing/profiles/consents/audit, repeatable migrations, Infisical-managed secrets, idempotent writes — *verified v1.0*
- [x] **MSG-01..05**: Pairing codes, QR/code screen, Photon/Spectrum inbound webhook, welcome message, delivery state tracking — *verified v1.0*

**LinkedIn ingestion and operations:**

- [x] **LINK-01..04**: Clerk/OAuth-authorized profile storage, explicit enrichment consent, browser-enrichment gated behind compliance design, student review/correction UI — *verified v1.0*
- [x] **OPS-01..04**: Fly health checks, webhook signature validation, no sensitive-data logging, documented privacy/delete/export paths — *verified v1.0*

### v1.1 — Seamless Waitlist

- [x] **WAIT-01**: Authenticated users land directly on QR/SMS pairing — *verified 2026-05-15*
- [x] **WAIT-02**: QR opens the exact verification text `Hey internjobs.ai! My verification code is {CODE}. What's next?` — *verified 2026-05-15*
- [x] **WAIT-03**: 8-character pairing code is short, unique, and textable — *verified 2026-05-15*
- [x] **THREAD-01**: Follow-up texts from the same phone attach to the verified student via normalized phone-number routing — *verified 2026-05-15*
- [x] **GRAPH-01**: Durable `student_threads` placeholder records created for Cognee hosted handoff (no provider call) — *verified 2026-05-15*
- [x] **ENRICH-01**: Durable `profile_enrichment_jobs` placeholder records created for Sprite.dev + Bright Data handoff (no provider call) — *verified 2026-05-15*

## v1.2 — Two-Sided Agent MVP (Active)

Spectrum/Photon stays the only active student SMS path. v1.2 adds startups + an operator approval gate, with Mastra as the agent core. Telnyx is held for v1.3.

### Pre-flight

- [ ] **SEC-01**: Cloudflare DNS proxy on `accounts.internjobs.ai` and `clerk.internjobs.ai` is set to DNS-only (gray cloud) and a real LinkedIn → Clerk → app sign-in completes end-to-end against prod Clerk. Gates all subsequent v1.2 phases — no new user type (startup, operator) can authenticate until this is fixed.

### SMS Provider Abstraction

- [ ] **SMS-01**: Existing Spectrum/Photon send/receive path is refactored behind an `SmsProvider` interface so a Telnyx (or other) adapter can drop in later without touching call-sites. v1.2 ships exactly one implementation (Spectrum/Photon); no Telnyx stub, no second number.

### Startup Identity

- [ ] **STARTUP-01**: Startup founder can sign in with email/password, Google, or Microsoft via Clerk (LinkedIn is NOT required) and land on a startup dashboard. Clerk user ID stored in Neon. Identity uses a single Clerk app with `publicMetadata.userType = 'startup'` (not a separate Clerk app).
- [ ] **STARTUP-02**: Startup completes profile capture (company name, website, founder name, email) and grants explicit `messaging_on_behalf` consent before reaching agent features. New Neon schema: `startups`, `startup_members`, `startup_consents`. Middleware blocks agent surfaces without consent.

### Roles Catalog

- [ ] **ROLE-01**: Startup founder can create, view, edit, and deactivate roles (title, description, requirements, status, location, comp range) from the startup dashboard. Stored in Neon `roles` table and readable by the agent. Deactivate sets `status='paused'` (no hard delete) so agent references stay valid.

### Startup Email Channel

- [ ] **EMAIL-01**: Email sent to `internjobs.ai` startup-facing addresses is received by a Cloudflare Worker via Cloudflare Email Routing. Worker validates and forwards a signed payload (HMAC / shared secret) to a Mastra ingest endpoint on the Fly app. Receipt is logged in `audit_events`.
- [ ] **EMAIL-02**: Outbound transactional email via Cloudflare Email Service (public beta 2026-04-17, the "Agent Mail" product) is configured for sending operator-approved agent drafts to startups, with SPF + DKIM + DMARC + `cf-bounce.internjobs.ai` MX verified on the `internjobs.ai` zone. `noreply@internjobs.ai` (or equivalent) deliverable to Gmail/Outlook end-to-end. CF Email Routing handles inbound; CF Email Service handles outbound — same vendor, one less integration to operate.

### Agent Core (Mastra)

- [ ] **AGENT-01**: When a student inbound SMS arrives (Spectrum/Photon path), the Mastra workflow fires, reads the student's profile context, matches against active `roles`, and writes a student-side draft message to a `drafts` table with `status='pending_review'`. v1.2 match is keyword heuristic; pgvector match is layered on via AGENT-03. *Workers AI direct REST (no OpenAI billing, no proxy Worker, no AI Gateway) — 2026-05-16 tear-out.*
- [ ] **AGENT-02**: Mastra maintains persistent thread memory keyed separately by `student_id` and `startup_id`, backed by Postgres (Mastra `PostgresStore`) under a dedicated `mastra` Postgres schema (`schemaName: 'mastra'`, never `public`). Thread context prevents duplicate intros and supports full conversation history. *Workers AI direct REST (no OpenAI billing, no proxy Worker, no AI Gateway) — 2026-05-16 tear-out.*
- [ ] **AGENT-03**: pgvector semantic memory enabled on Neon (`vector` extension + HNSW index created in migration, not deferred). Student profile and role embeddings written on save/update. Embedding model is Cloudflare Workers AI `@cf/baai/bge-base-en-v1.5` (768-dim) via direct REST (`api.cloudflare.com/client/v4/accounts/{id}/ai/run/...` with `Authorization: Bearer {CLOUDFLARE_AI_API_TOKEN}`); vector column is `vector(768)`. Agent match optionally uses cosine similarity when `USE_VECTOR_MATCH` flag is set; falls back to AGENT-01 keyword match otherwise. *Workers AI direct REST (no OpenAI billing, no proxy Worker, no AI Gateway) — 2026-05-16 tear-out.*

### Operator Approval Gate

- [ ] **APPROVE-01**: Operator dashboard at `/ops/drafts` (single Clerk app with `publicMetadata.userType = 'operator'`, not a DB flag) lists all pending agent drafts (student-side SMS replies + startup-side emails) with conversation context, and supports approve / edit-then-approve / reject (with optional free-text reason) on each draft.
- [ ] **APPROVE-02**: No auto-send in v1.2 — every outbound message is operator-approved. Approving sends through the correct channel (Spectrum SMS for students via the `SmsProvider`, outbound email provider for startups) and records `status='sent'` + `provider_message_id`. Rejected drafts feed a feedback log readable by the human prompt-tuner.

### Storage & Threading

- [ ] **EMAIL-03**: Outbound startup emails set `Reply-To: conv-{conversation_id}@agent.internjobs.ai`. The catch-all Worker bound to the `agent.internjobs.ai` subdomain parses the `conv-` prefix on inbound, extracts the UUID, and the Fly app writes it into `inbound_messages.metadata.conversation_id`. Replaces fragile From-address lookup as the PRIMARY inbound startup identification path; legacy lookup stays as fallback when the alias is absent. **Subdomain isolation (2026-05-16 update):** aliases live on the dedicated `agent.internjobs.ai` subdomain (NOT the apex) so the apex `internjobs.ai` stays free for human/employee email (raj@, support@); hard separation prevents a stripped-subdomain typo from accidentally invoking the Worker.
- [ ] **STORAGE-01**: R2 bucket `internjobs-agent-store` (private, signed-URL-only) scaffolded. Per-entity folder convention (`students/{id}/`, `startups/{id}/`, `conversations/{id}/`, `startups/{id}/roles/{role_id}/`). R2 client at `apps/app/src/storage/r2.mjs` with fail-soft singleton (`getR2Client()` returns null when envs unset). NO ingestion wired yet — just the storage layer.

### Integration Acceptance

- [ ] **INTEG-01**: Two-sided smoke test executes end-to-end in production without manual DB intervention: student inbound (Spectrum) → agent draft → operator approve → startup email send → startup reply (CF Email Routing → Worker → Mastra ingest) → agent draft → operator approve → student SMS (Spectrum). All 11 steps from `.planning/milestones/v1.2-two-sided-agent-mvp/research/FEATURES.md` INTEG-01 pass.

## Future Milestones

Named candidates for v1.3+. No checkboxes — these become Active when promoted via `/rrr:new-milestone`.

### v1.3 Candidates

*Carry-over from v1.2 Out of Scope + research suggestions*

- **TELNYX-ADAPT-01**: Telnyx adapter implementation of the `SmsProvider` interface (provisioning, Ed25519 webhook verification, A2P 10DLC registration) — *Source: v1.2 scope revision; SMS-01 ships the seam, not the adapter*
- **TELNYX-MIGRATE-01**: Soft cutover state machine + one-time migration SMS for existing Spectrum students (cross-provider duplicate handling per PITFALLS #4–#6) — *Source: v1.2 research*
- **SUNSET-01**: Hard Spectrum sunset — gate: ≥30 days stable on Telnyx, zero student SMS regressions, A2P 10DLC registration complete — *Source: v1.2 research*
- **COGNEE-ACTIVATE-01**: Light up Cognee hosted handoff against the v1.1 `student_threads` placeholders; gate is matching-quality plateau or explicit need — *Source: PROJECT.md Out of Scope*
- **ENRICH-ACTIVATE-01**: Light up Sprite.dev + Bright Data against v1.1 `profile_enrichment_jobs` placeholders; gate is legal/compliance approval — *Source: PROJECT.md Out of Scope*
- **VOICE-01**: Voice channel for students (any provider) — gate: >10% inbound asks for voice — *Source: PROJECT.md Out of Scope*
- **SLACK-01**: Slack channel for startups (instead of/alongside email) — gate: first 5–10 startups indicate Slack > email — *Source: PROJECT.md Out of Scope*
- **STARTUP-SMS-01**: Second SMS number dedicated to startup-side messaging — gate: startup feedback that email alone is insufficient — *Source: PROJECT.md Out of Scope*
- **FEEDBACK-LOOP-01**: Automated draft feedback loop — structured rejection reasons (enum, not free text) feed Mastra prompt tuning automatically — *Source: v1.2 research*
- **THREAD-SUMMARY-01**: Background job that summarizes Mastra threads exceeding ~50 messages so context windows don't bloat — *Source: PITFALLS #19*
- **CONSENT-INFER-01**: Extend `consents` table with `agent_inference_consent` so the agent can persist inferences derived from startup emails about students (TCPA/CAN-SPAM surface) — *Source: PITFALLS #15*
- **MULTI-MEMBER-01**: Multi-member invites for startups (v1.2 ships one founder per startup only) — *Source: v1.2 research*
- **STORAGE-02**: Email attachment ingest + MMS attachment ingest. Phase 03 Worker writes attachments to R2 per-entity folders; Mastra workflow reads referenced files into thread context — *Source: v1.2 STORAGE-01 scope-add*
- **STORAGE-03**: Permanent short links via mapping bucket + redirector Worker (STAB-02 pattern from SuperIntelligence) — replaces 1h presigned URL TTL in outbound channel messages — *Source: v1.2 STORAGE-01 scope-add*
- **EMAIL-04**: Per-startup vanity addresses (e.g. `acme@internjobs.ai` forwards to the startup's real email) — branding nicety, not load-bearing — *Source: v1.2 EMAIL-03 scope-add*

### Backlog (Unassigned)

- **SEC-ROTATE-01**: Rotate `CLERK_SECRET_KEY` (pasted in chat 2026-05-15); update Infisical `prod`/`/internjobs-ai` and re-run `flyctl secrets import`. *(Currently tracked as STATE.md blocker; not formally promoted to v1.2 requirement.)*
- **SEC-ROTATE-CF-EMAIL-01**: Rotate the Cloudflare Email Service API token pasted in chat 2026-05-16 (same posture as SEC-ROTATE-01). Update Infisical `prod`/`/internjobs-ai` `CLOUDFLARE_EMAIL_API_TOKEN` and re-run `flyctl secrets import`. Tracked as STATE.md blocker pending the v1.2 INTEG-01 smoke run.
- **SEC-ROTATE-CF-AI-01**: Rotate the Cloudflare Workers AI API token pasted in chat 2026-05-16 (same posture as SEC-ROTATE-CF-EMAIL-01). The token is scoped for Workers AI direct (used by `apps/app/src/embeddings.mjs` and `apps/app/src/workflows/student-inbound.mjs` to call `api.cloudflare.com/client/v4/accounts/{id}/ai/run/...`). Update Infisical `prod`/`/internjobs-ai` `CLOUDFLARE_AI_API_TOKEN` and re-run `flyctl secrets import`. Tracked as STATE.md blocker pending the next post-launch rotation pass.

## Out of Scope

Explicit exclusions. Documented to prevent scope creep.

| Feature | Reason | Revisit? |
|---------|--------|----------|
| LinkedIn credential capture / private-surface scraping | High legal/security risk; Clerk OAuth + user-authorized data only | Never (without legal review) |
| Replacing marketing site with the app | Marketing stays a static Cloudflare Pages deployment | Never |
| ATS or recruiter dashboard | Wrong product feel; app stays messaging-first | Never |
| Auto-send of agent-drafted messages | Breaks product promise + legal posture | Never in v1.2; revisit only with strong safety evidence |
| Cognee in v1.2 | Agent memory lives in Mastra thread + pgvector; placeholders stay inert | v1.3+ (COGNEE-ACTIVATE-01) |
| Telnyx activation in v1.2 | Avoid stacking unfamiliar SMS platform on unfamiliar agent framework in one milestone; v1.2 ships only the `SmsProvider` seam (SMS-01) | v1.3 (TELNYX-ADAPT-01) |
| Voice (any provider) | Not yet validated as user need | v1.3 gated on >10% inbound asks |
| Slack integration for startups | Email is the v1.2 startup channel | v1.3 gated on first 5–10 startups asking |
| Second SMS number for startup SMS | Email covers startups in v1.2 | v1.3 gated on startup feedback |
| Sprite.dev + Bright Data browser enrichment activation | Placeholders stay inert until legal/compliance approval | v1.3+ (ENRICH-ACTIVATE-01) |
| `students.sms_provider` column / cross-provider state machine | Only one provider live in v1.2 — column lands when Telnyx adapter does | v1.3 (with TELNYX-ADAPT-01) |

## Traceability

Maps current-milestone (v1.2) requirements to roadmap phases.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 01 — Pre-flight + SMS Abstraction | Pending |
| SMS-01 | Phase 01 — Pre-flight + SMS Abstraction | Pending |
| STARTUP-01 | Phase 02 — Startup Identity, Consent & Roles | Pending |
| STARTUP-02 | Phase 02 — Startup Identity, Consent & Roles | Pending |
| ROLE-01 | Phase 02 — Startup Identity, Consent & Roles | Pending |
| EMAIL-01 | Phase 03 — Startup Email Channel | Pending |
| EMAIL-02 | Phase 03 — Startup Email Channel | Pending |
| AGENT-01 | Phase 04 — Mastra Agent Core | Pending |
| AGENT-02 | Phase 04 — Mastra Agent Core | Pending |
| AGENT-03 | Phase 04 — Mastra Agent Core | Pending |
| APPROVE-01 | Phase 05 — Operator Approval Gate | Pending |
| APPROVE-02 | Phase 05 — Operator Approval Gate | Pending |
| EMAIL-03 | Phase 03/04 enhancement (scope-add 2026-05-16) | Pending |
| STORAGE-01 | Phase 04 enhancement (scope-add 2026-05-16) | Pending |
| INTEG-01 | Phase 06 — Two-Sided Integration Smoke Test | Pending |

**Coverage (v1.2):**
- Active requirements: 15 total
- Mapped to phases: 15 ✓
- Unmapped: 0

---
*Requirements defined: 2026-05-16*
*Last updated: 2026-05-16 — EMAIL-03 subdomain isolation: agent aliases moved from apex `internjobs.ai` to dedicated `agent.internjobs.ai` subdomain (hard cut-over, no apex fallback). Worker bound to `*@agent.internjobs.ai`; apex stays free for human/employee email via separate forward-to-personal-inbox rules. Earlier 2026-05-16: Workers AI direct tear-out: AGENT-01..03 re-annotated (proxy Worker removed; Fly Node app now calls Workers AI REST directly with `CLOUDFLARE_AI_API_TOKEN`). SEC-ROTATE-CF-AI-01 added to backlog. Earlier 2026-05-16: STORAGE-01 + EMAIL-03 scope-add (R2 per-entity folder scaffold + per-conversation Reply-To aliases for deterministic threading; modeled on SuperIntelligence patterns); SEC-ROTATE-CF-EMAIL-01 added to backlog; v1.3 candidates extended with STORAGE-02, STORAGE-03, EMAIL-04. Prior 2026-05-16 updates: Resend → Cloudflare Email Service swap for EMAIL-02; v1.2 scope revision (Telnyx held for v1.3; Spectrum stays active behind `SmsProvider` seam).*
