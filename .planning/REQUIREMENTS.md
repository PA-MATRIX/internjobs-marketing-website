# Requirements: InternJobs.ai

**Defined:** 2026-05-19
**Core Value:** InternJobs.ai helps students and startups meet through natural messages, not resume piles or application black holes.
**Current Milestone:** v1.3 Pilot Hardening

## Validated

Requirements shipped and verified. These are immutable — they represent what works.

### v1.0 — Waitlist Identity and Messaging Foundation (shipped 2026-05-09)

- [x] **MKT-01..02**: Public student landing at `/` + public startup page at `/startups` — *verified 2026-05-09*
- [x] **LEGAL-01..02**: Privacy + Terms pages — *verified 2026-05-09*
- [x] **DEPLOY-01**: Marketing deploy verifies production CSS/JS — *verified 2026-05-09*
- [x] **ARCH-01..04**: Separately deployable `apps/marketing` + `apps/app` workspaces with shared contracts — *verified 2026-05-09*
- [x] **AUTH-01..04**: Clerk-first LinkedIn auth, no email/password in student waitlist, post-auth lands on pairing, Clerk user ID stored in Neon — *verified 2026-05-15 prod-activation*
- [x] **DATA-01..04**: Neon schema for students/waitlist/pairing/profiles/consents/audit, repeatable migrations, Infisical-managed secrets, idempotent writes — *verified 2026-05-09*
- [x] **MSG-01..05**: Pairing codes, QR/code screen, Photon/Spectrum inbound webhook, welcome message, delivery state tracking — *verified 2026-05-09*
- [x] **LINK-01..04**: Clerk/OAuth-authorized profile storage, explicit enrichment consent, browser-enrichment gated behind compliance design, student review/correction UI — *verified 2026-05-09*
- [x] **OPS-01..04**: Fly health checks, webhook signature validation, no sensitive-data logging, documented privacy/delete/export paths — *verified 2026-05-09*

### v1.1 — Seamless Waitlist and Threading (shipped 2026-05-15)

- [x] **WAIT-01..03**: Authenticated users land on QR/SMS pairing; QR opens exact verification text; 8-char pairing code — *verified 2026-05-15*
- [x] **THREAD-01**: Follow-up texts attach to the verified student via normalized phone-number routing — *verified 2026-05-15*
- [x] **GRAPH-01**: Durable `student_threads` placeholder records for Cognee handoff — *verified 2026-05-15*
- [x] **ENRICH-01**: Durable `profile_enrichment_jobs` placeholder records for Sprite.dev + Bright Data handoff — *verified 2026-05-15*

### v1.2 — Two-Sided Agent MVP + Parrot Workspace (shipped 2026-05-19)

- [x] **SMS-01**: `SmsProvider` interface seam fronting the Spectrum/Photon path — *verified 2026-05-19*
- [x] **STARTUP-01..02**: Dedicated startup Clerk app at workspace.internjobs.ai (phone-OTP) + startups/startup_members schema — *verified 2026-05-19*
- [x] **ROLE-01**: `roles` schema + in-app CRUD — *verified 2026-05-19*
- [x] **EMAIL-01..03**: CF Email Routing → Worker → Mastra ingest; CF Email Service outbound; per-conversation Reply-To aliases on `agent.internjobs.ai` — *verified 2026-05-19*
- [x] **AGENT-01..03**: Mastra agent core with thread memory + pgvector semantic memory — *verified 2026-05-19*
- [x] **AGENT-VOICE**: Llama 3.3 70B fp8-fast + explicit voice rules + few-shot exemplars — *verified 2026-05-17*
- [x] **MEMORY-01**: Self-hosted FalkorDB on Fly + Graphiti-style temporal facts in Node — *verified 2026-05-17 (graphReady=true; runtime activation for Parrot Worker deferred to v1.3 PHASE14-RUNTIME)*
- [x] **OPS-01..02**: Read-only `/ops/drafts` audit log + autonomous send with system-prompt guardrails — *verified 2026-05-17*
- [x] **STORAGE-01**: Private R2 bucket `internjobs-agent-store` with signed-URL-only access (scaffold) — *verified 2026-05-19*
- [x] **INTEG-01**: Two-sided autonomous smoke test (student SMS → agent → startup email → agent → student SMS) — *verified 2026-05-19*
- [x] **PARROT-WORKSPACE**: workspace.internjobs.ai with Slack-style UI, phone-OTP, three-tab Meetings, notification drawer + Web Push, OnboardingWizard — *verified 2026-05-19*
- [x] **DASHBOARD-AGENT**: kimi-k2.6 cross-channel todo extraction via CF AI Gateway with per-employee daily caps + prompt caching — *verified 2026-05-19*
- [x] **IMESSAGE-BRIDGE**: BlueBubbles on HostMyApple Mac mini + Cloudflare Tunnel — *verified 2026-05-19*
- [x] **AGENTIC-INBOX**: Maya MCP Worker at agent.internjobs.ai + R2 attachments + CF Access SSO — *verified 2026-05-19*
- [x] **LINK-ENRICH-QR**: Proxycurl enrichment + Standout-style QR onboarding — *verified 2026-05-19*
- [x] **DAILY-CO**: Per-employee always-on personal rooms + ephemeral StartMeeting CTA — *verified 2026-05-19*
- [x] **MATTERMOST-OIDC**: Mattermost OIDC SSO bridge via Parrot `/oidc/*` — *verified 2026-05-19*
- [x] **ADMIN-INVITE**: Admin invite UX with capability toggles + phone-OTP + warm welcome email — *verified 2026-05-19*

## v1.3 — Pilot Hardening (Active)

Make v1.2 production-safe for the first 5-10 startup pilots. Tight 4-item scope sourced from `.planning/milestones/v1.3-pilot-hardening/research/SUMMARY.md` (research synthesized 2026-05-19).

### Graph Bridge — PHASE14-RUNTIME

Wire the v1.2 FalkorDB graph layer to the Parrot Worker via a Fly REST proxy (`internjobs-graph-api`). Workers RESP3 path ruled out — `cloudflare:sockets` blocks private IPs + no Cypher support in available Workers-runtime Redis libraries.

- [ ] **GRAPH-PROXY-01**: New Fly app `internjobs-graph-api` deployed in `internjobs-sios-org`/`ord` with `min_machines_running = 1` (always-warm to keep Worker dashboard reads off cold-start path)
- [ ] **GRAPH-PROXY-02**: `infra/graph-api/` directory contains `fly.toml`, `Dockerfile`, and `src/index.mjs` (Hono/Node) exposing `POST /query` and `GET /health`
- [ ] **GRAPH-PROXY-03**: `POST /query` accepts `{ cypher, params, namespace? }` and returns `{ data, error? }`; authenticated via `Authorization: Bearer ${GRAPH_API_SECRET}`
- [ ] **GRAPH-PROXY-04**: `GRAPH_API_SECRET` (new secret) and `GRAPH_API_URL` added to Infisical `/internjobs-ai` before first deploy
- [ ] **GRAPH-PROXY-05**: `FALKORDB_URL` and `FALKORDB_PASSWORD` removed from Parrot Worker env (no longer needed — proxy holds the FalkorDB client)
- [ ] **GRAPH-WORKER-01**: `apps/parrot/workers/lib/graph.ts` rewired — dynamic `falkordb` import guard removed, transport replaced with `fetch()` to `${GRAPH_API_URL}/query`
- [ ] **GRAPH-WORKER-02**: `workers/types.ts` env definitions swap `FALKORDB_URL`/`FALKORDB_PASSWORD` for `GRAPH_API_URL`/`GRAPH_API_SECRET`
- [ ] **GRAPH-WORKER-03**: Parrot Worker `/healthz` returns both `graph_ready: true` AND `graph_proxy_reachable: true` (distinct fields to distinguish DB-down from proxy-down)
- [ ] **GRAPH-VERIFY-01**: Manual smoke test against production FalkorDB passes 4 operations: `ensureParrotGraphSchema`, `recordTodoFact`, `getActiveTodos`, `getEmployeeContext` (shapes correct, no errors)
- [ ] **GRAPH-VERIFY-02**: `npm run smoke:parrot-graph` exits 0 with all invariants PASS
- [ ] **GRAPH-VERIFY-03**: A real inbound email triggers `extractTodosFromEmail` and logs `{"event":"graph_context_injected","chars":>0}` in production

### Todo Auto-Resolution — PARROT-AUTO-CLEAR

Cron-based reconciliation: when a Graphiti fact's `valid_to` is set, the underlying todo auto-resolves with full audit trail + undo. Strictly blocked on PHASE14-RUNTIME.

- [ ] **AUTO-CLEAR-01**: `wrangler.jsonc` adds cron trigger `*/5 * * * *` on the `internjobs-parrot` Worker
- [ ] **AUTO-CLEAR-02**: `scheduled` handler in `workers/app.ts` invokes new `workers/lib/auto-clear.ts`
- [ ] **AUTO-CLEAR-03**: Auto-clear Cypher guards with `fact.valid_to < NOW() - INTERVAL '5 minutes'` (minimum-open-window guard — prevents race-condition false clears)
- [ ] **AUTO-CLEAR-04**: `EmployeeMailboxDO` migration 8 adds `resolution_source TEXT` nullable column to todos table
- [ ] **AUTO-CLEAR-05**: `TodoItem` interface gains `resolution_source: 'agent' | 'user' | null`
- [ ] **AUTO-CLEAR-06**: `EmployeeMailboxDO` exposes `resolveTodo(sourceId, source)` RPC method
- [ ] **AUTO-CLEAR-07**: `GET /api/dashboard/todos?view=resolved` returns resolved todos with `resolution_source` + `resolved_at`
- [ ] **AUTO-CLEAR-08**: `POST /api/dashboard/todos/:id/unresolve` is idempotent — clears `resolved_at` and fail-soft sets `valid_to = NULL` in graph
- [ ] **AUTO-CLEAR-UX-01**: "Resolved" secondary nav item added to workspace dashboard
- [ ] **AUTO-CLEAR-UX-02**: Agent-cleared todo animates out of active list (CSS slide-up + fade, ~250ms)
- [ ] **AUTO-CLEAR-UX-03**: "Recently resolved" view shows agent-cleared todos with violet "Agent" pill + relative timestamp
- [ ] **AUTO-CLEAR-UX-04**: One-click undo restores todo to active list
- [ ] **AUTO-CLEAR-UX-05**: First auto-clear per session shows one-time toast; dismissed state persisted in localStorage per employee
- [ ] **AUTO-CLEAR-VERIFY-01**: Smoke test for cross-namespace Cypher query (`:Fact` in student namespace, `:Todo` in employee namespace) passes
- [ ] **AUTO-CLEAR-VERIFY-02**: End-to-end: reply in Mattermost thread → todo disappears from active list within 30s → appears in Resolved view → Undo restores it

### Pre-LLM Safety Screening — SAFETY-01

Lakera Guard pre-LLM screening on student SMS and email inbound. Fail-open. Soft-flag default; hard-block on `prompt_injection >= 0.8`. **Lakera was acquired by Cisco in May 2025 — verify current API at `platform.lakera.ai` before any integration code is written.**

- [ ] **SAFETY-LAKERA-01**: Lakera/Cisco AI Defense account provisioned; current API endpoint + auth format + response schema verified at `platform.lakera.ai`; pricing tier confirmed (Community 10k/month insufficient for 30k/month pilot — Pro tier required)
- [ ] **SAFETY-LAKERA-02**: `LAKERA_GUARD_API_KEY` added to Infisical `/internjobs-ai`; deployed to both Fly student app and Parrot Worker
- [ ] **SAFETY-NODE-01**: `apps/app/src/safety/screen.mjs` — Node fetch helper with 1s hard timeout, fail-open, structured response `{ flagged, action, reason, score, raw }`
- [ ] **SAFETY-WORKER-01**: `apps/parrot/workers/lib/safety.ts` — Worker fetch helper, same contract as Node version (deliberately not shared — 30-line helpers, ESM vs TS module boundary friction not worth abstracting)
- [ ] **SAFETY-INSERT-01**: `apps/app/src/webhooks/photon.mjs` calls `screenMessage()` BEFORE any Mastra workflow step on student SMS inbound
- [ ] **SAFETY-INSERT-02**: `apps/parrot/workers/lib/inbound-email.ts` calls `screenMessage()` BEFORE `extractTodosFromText()` on email ingest
- [ ] **SAFETY-SCOPE-01**: Mattermost ingest is explicitly NOT screened (internal channel — wrong threat model, wastes Lakera quota)
- [ ] **SAFETY-SCOPE-02**: Email from known startup_members senders is NOT screened (already authenticated identity)
- [ ] **SAFETY-POLICY-01**: Hard-block rule — `prompt_injection` score >= 0.8, unconditional across channels; message dropped + logged with `action='hard_blocked'`
- [ ] **SAFETY-POLICY-02**: Soft-flag default — all other flag categories let the message through, logged to `/ops/safety` with `action='soft_flagged'`
- [ ] **SAFETY-POLICY-03**: Fail-open — Lakera timeout (>1s) or 5xx → logged as `action='passed_lakera_unavailable'`, message proceeds normally
- [ ] **SAFETY-RESPONSE-01**: Student SMS hard-block triggers exact agent-voice reply: `"hey — couldn't process that one. try rephrasing?"` (lowercase, no emojis, matches AGENT-VOICE rules)
- [ ] **SAFETY-RESPONSE-02**: Email hard-block does NOT auto-reply (out-of-office loop risk); logged in `/ops/safety` only
- [ ] **SAFETY-LOG-01**: `safety_events` table in Neon (NOT per-employee DO SQLite — operator view is cross-employee) with columns: `id`, `created_at`, `channel`, `direction`, `sender_last4`, `action`, `reason_label`, `score`, `preview_80char`
- [ ] **SAFETY-VIEW-01**: `/ops/safety` route renders the flag log; reviewer can mark a flag reviewed
- [ ] **SAFETY-BADGE-01**: Red dot badge on `/ops/safety` nav item when any unreviewed flag exists within last 24h
- [ ] **SAFETY-VERIFY-01**: Injection test SMS (e.g., "ignore previous instructions and …") appears in `/ops/safety` as hard-blocked AND student receives the canned reply
- [ ] **SAFETY-VERIFY-02**: Benign student SMS produces no log entry (zero noise on clean traffic)
- [ ] **SAFETY-VERIFY-03**: p99 latency on screen call instrumented; if >500ms after first pilot week, move to fire-and-forget pattern with 200ms budget

### Credential Rotation — SEC-ROTATE

Rotate 5 token families (not 4 — two Clerk apps). No code changes. Run LAST as the definitive green-board for v1.3 ship. Critical constraint: `CLOUDFLARE_AI_API_TOKEN` is shared by Fly student app + Parrot Worker — rotate Fly first, verify, then Worker, then revoke old.

- [ ] **SEC-ROTATE-ORDER**: Rotation sequence per token: generate new → write Infisical → redeploy consuming services → verify `/healthz` green + one live action → only then revoke old in vendor dashboard
- [ ] **SEC-ROTATE-CLERK-01**: Clerk student app (`Internjobs.ai` / `app_38BrRDRKnvbo7vlE2ZZtMc7hFPC`) Secret Key rotated via multi-key overlap (add new → deploy → verify → delete old); JWT Signing Key NOT touched
- [ ] **SEC-ROTATE-CLERK-02**: Clerk workspace app (employee phone-OTP at workspace.internjobs.ai) Secret Key rotated via same procedure
- [ ] **SEC-ROTATE-EMAIL-01**: CF Email token inventory audit — confirm whether `CLOUDFLARE_EMAIL_API_TOKEN` or `CLOUDFLARE_EMAIL_ROUTING_API_TOKEN` is the live one in Infisical and which Worker consumes it
- [ ] **SEC-ROTATE-EMAIL-02**: CF Email API token rotated (correct one identified above)
- [ ] **SEC-ROTATE-AI-01**: `CLOUDFLARE_AI_API_TOKEN` rotated — Fly student app FIRST: `fly secrets set`, verify `/healthz workersAiReady: true` + one live student SMS turn succeeds
- [ ] **SEC-ROTATE-AI-02**: After Fly verified, Parrot Worker AI Gateway credential updated and verified; THEN and only then old token revoked in CF dashboard
- [ ] **SEC-ROTATE-BROAD-01**: Broad-scope CF API token rotated LAST — local shell env updated first, then wrangler-deployed services, then Infisical, then revoke
- [ ] **SEC-ROTATE-GRAPH-01**: `GRAPH_API_SECRET` (new v1.3 credential introduced by PHASE14-RUNTIME) included in SEC-ROTATE inventory + Infisical
- [ ] **SEC-ROTATE-VERIFY-01**: All `/healthz` endpoints green across student app, Parrot Worker, agentic-inbox Worker, graph-api Fly app
- [ ] **SEC-ROTATE-VERIFY-02**: Old tokens confirmed "Revoked" in Clerk dashboards (both apps) + Cloudflare dashboard
- [ ] **SEC-ROTATE-VERIFY-03**: JWKS endpoint `https://clerk.internjobs.ai/.well-known/jwks.json` returns valid JSON post-rotation
- [ ] **SEC-ROTATE-VERIFY-04**: No error rate spike (≤ baseline) on either Clerk app for 15 minutes following rotation

## Future Milestones

Candidates flagged by v1.3 milestone research or deferred from v1.2 — not in current roadmap.

### v1.4 Candidates

*Source: v1.3 milestone research (research/SUMMARY.md) and v1.2 audit deferrals*

- **TELNYX-ADAPT-01 / TELNYX-MIGRATE-01 / SUNSET-01** — Telnyx SMS adapter migration; A2P 10DLC registration takes weeks
- **STORAGE-02** — Email + MMS attachment ingest into R2
- **STORAGE-03** — Permanent short links via mapping bucket + redirector Worker
- **EMAIL-04** — Per-startup vanity addresses (`acme@internjobs.ai`)
- **DAILY-VANITY-01** — Custom Daily.co subdomain `meet.internjobs.ai`
- **STARTUP-SMS-01** — Second SMS number for startup-side messaging
- **CONSENT-INFER-01** — `agent_inference_consent` on the consents table
- **FEEDBACK-LOOP-01** — Automated draft feedback loop into prompt tuning
- **THREAD-SUMMARY-01** — Background summarizer for long Mastra threads
- **MULTI-MEMBER-01** — Multi-member startup invites
- **SAFETY-OUTBOUND-01** — Lakera Guard on agent outbound messages (gate: first pilot report of an agent message causing reputational harm)
- **SAFETY-HARD-BLOCK-EXPAND-01** — Convert student SMS soft-flag → hard-block once 30 days of pilot FP-rate data exists
- **WORKERS-VPC-REVISIT** — If Workers VPC reaches GA with viable pricing, retire `internjobs-graph-api` Fly proxy in favor of native CF service binding

### Backlog (Unassigned)

- **COGNEE-ACTIVATE-01** — Activate Cognee placeholders (still gated on legal approval)
- **ENRICH-ACTIVATE-01** — Activate Sprite.dev + Bright Data placeholders (still gated on legal approval)
- **VOICE-01** — Voice channel (demand-gated on >10% inbound voice asks)
- **SLACK-01** — Slack integration for startups (demand-gated on first 5-10 startups preferring Slack > email)

## Out of Scope

| Feature | Reason | Revisit? |
|---------|--------|----------|
| LinkedIn credential capture or login scraping | High legal/security risk | Never |
| Automated private LinkedIn scraping | Likely violates platform expectations | Only after legal review + approved API path |
| Replacing the marketing site with the app | Marketing remains static CF Pages | Never |
| ATS or recruiter dashboard | Wrong product feel — app stays messaging-first | Never |
| Telnyx activation in v1.3 | A2P 10DLC registration takes weeks (external timeline) | v1.4 |
| Cognee activation in v1.3 | Legal-gated | When legal cleared |
| Sprite.dev + Bright Data activation in v1.3 | Legal-gated | When legal cleared |
| STORAGE-02/03, EMAIL-04, DAILY-VANITY-01 in v1.3 | Pilot polish, not pilot-blocking | v1.3 patches if needed, otherwise v1.4 |
| Voice channel (any provider) | Demand-gated | When >10% inbound asks for voice |
| Slack integration for startups | Demand-gated | When first 5-10 startups prefer Slack |
| 2nd SMS number for startup-side SMS | Demand-gated | When startup feedback shows email insufficient |
| Outbound message safety screening | System-prompt guardrails cover v1.3 scale | After pilot harm event OR v1.4 |
| Rotating Clerk JWT Signing Keys in SEC-ROTATE | Mass user sign-out across both apps | Only on confirmed signing-key compromise |
| Workers-native RESP3 client for FalkorDB | `cloudflare:sockets` blocks private IPs + no Cypher lib support today | When Workers VPC reaches GA |

## Traceability

Which phases cover which requirements for the current milestone.

| Requirement | Phase | Status |
|-------------|-------|--------|
| GRAPH-PROXY-01..05 | Phase 18 | Pending |
| GRAPH-WORKER-01..03 | Phase 18 | Pending |
| GRAPH-VERIFY-01..03 | Phase 18 | Pending |
| AUTO-CLEAR-01..08 | Phase 19 | Pending |
| AUTO-CLEAR-UX-01..05 | Phase 19 | Pending |
| AUTO-CLEAR-VERIFY-01..02 | Phase 19 | Pending |
| SAFETY-LAKERA-01..02 | Phase 20 | Pending |
| SAFETY-NODE-01, SAFETY-WORKER-01 | Phase 20 | Pending |
| SAFETY-INSERT-01..02, SAFETY-SCOPE-01..02 | Phase 20 | Pending |
| SAFETY-POLICY-01..03, SAFETY-RESPONSE-01..02 | Phase 20 | Pending |
| SAFETY-LOG-01, SAFETY-VIEW-01, SAFETY-BADGE-01 | Phase 20 | Pending |
| SAFETY-VERIFY-01..03 | Phase 20 | Pending |
| SEC-ROTATE-ORDER, CLERK-01..02 | Phase 21 | Pending |
| SEC-ROTATE-EMAIL-01..02, AI-01..02 | Phase 21 | Pending |
| SEC-ROTATE-BROAD-01, GRAPH-01 | Phase 21 | Pending |
| SEC-ROTATE-VERIFY-01..04 | Phase 21 | Pending |

**Coverage (v1.3):**
- Active requirements: 58 total (11 graph + 15 auto-clear + 19 safety + 13 SEC-ROTATE)
- Mapped to phases: 58
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-19*
*Source: `.planning/milestones/v1.3-pilot-hardening/research/SUMMARY.md` §4 New Requirements Discovered*
