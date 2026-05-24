# Requirements: InternJobs.ai

**Defined:** 2026-05-19 (v1.3); rewritten 2026-05-24 (v1.4)
**Core Value:** InternJobs.ai helps students and startups meet through natural messages, not resume piles or application black holes.
**Current Milestone:** v1.4 Pilot Readiness

## Validated

Requirements shipped and verified. These are immutable — they represent what works.

### v1.0 — Waitlist Identity and Messaging Foundation (shipped 2026-05-09)

- [x] **MKT-01..02**: Public student landing at `/` + public startup page at `/startups` — *verified 2026-05-09*
- [x] **LEGAL-01..02**: Privacy + Terms pages — *verified 2026-05-09*
- [x] **DEPLOY-01**: Marketing deploy verifies production CSS/JS — *verified 2026-05-09*
- [x] **ARCH-01..04**: Separately deployable `apps/marketing` + `apps/app` workspaces with shared contracts — *verified 2026-05-09*
- [x] **AUTH-01..04**: Clerk-first LinkedIn auth, no email/password in student waitlist, post-auth lands on pairing, Clerk user ID stored in Neon — *verified 2026-05-15 prod-activation*
- [x] **DATA-01..04**: Postgres schema for students/waitlist/pairing/profiles/consents/audit, repeatable migrations, Infisical-managed secrets, idempotent writes — *verified 2026-05-09 (DB moved from Neon → self-hosted Fly Postgres 2026-05-21)*
- [x] **MSG-01..05**: Pairing codes, QR/code screen, Photon/Spectrum inbound webhook, welcome message, delivery state tracking — *verified 2026-05-09*
- [x] **LINK-01..04**: Clerk/OAuth-authorized profile storage, explicit enrichment consent, browser-enrichment gated behind compliance design, student review/correction UI — *verified 2026-05-09*
- [x] **OPS-01..04**: Fly health checks, webhook signature validation, no sensitive-data logging, documented privacy/delete/export paths — *verified 2026-05-09*

### v1.1 — Seamless Waitlist and Threading (shipped 2026-05-15)

- [x] **WAIT-01..03**: Authenticated users land on QR/SMS pairing; QR opens exact verification text; 8-char pairing code — *verified 2026-05-15*
- [x] **THREAD-01**: Follow-up texts attach to the verified student via normalized phone-number routing — *verified 2026-05-15*
- [x] **GRAPH-01**: Durable `student_threads` placeholder records for Cognee handoff — *verified 2026-05-15*
- [x] **ENRICH-01**: Durable `profile_enrichment_jobs` placeholder records for Sprite.dev + Bright Data handoff — *verified 2026-05-15*

### v1.2 — Two-Sided Agent MVP + Workspace (shipped 2026-05-19)

- [x] **SMS-01**: `SmsProvider` interface seam fronting the Spectrum/Photon path — *verified 2026-05-19*
- [x] **STARTUP-01..02**: Dedicated startup Clerk app at workspace.internjobs.ai (phone-OTP) + startups/startup_members schema — *verified 2026-05-19*
- [x] **ROLE-01**: `roles` schema + in-app CRUD — *verified 2026-05-19*
- [x] **EMAIL-01..03**: CF Email Routing → Worker → Mastra ingest; CF Email Service outbound; per-conversation Reply-To aliases on `agent.internjobs.ai` — *verified 2026-05-19*
- [x] **AGENT-01..03**: Mastra agent core with thread memory + pgvector semantic memory — *verified 2026-05-19*
- [x] **AGENT-VOICE**: Llama 3.3 70B fp8-fast + explicit voice rules + few-shot exemplars — *verified 2026-05-17*
- [x] **MEMORY-01**: Self-hosted FalkorDB on Fly + Graphiti-style temporal facts in Node — *verified 2026-05-17*
- [x] **OPS-01..02**: Read-only `/ops/drafts` audit log + autonomous send with system-prompt guardrails — *verified 2026-05-17*
- [x] **STORAGE-01**: Private R2 bucket `internjobs-agent-store` with signed-URL-only access (scaffold) — *verified 2026-05-19*
- [x] **INTEG-01**: Two-sided autonomous smoke test (student SMS → agent → startup email → agent → student SMS) — *verified 2026-05-19*
- [x] **WORKSPACE-APP**: workspace.internjobs.ai with Slack-style UI, phone-OTP, three-tab Meetings, notification drawer + Web Push, OnboardingWizard — *verified 2026-05-19*
- [x] **DASHBOARD-AGENT**: kimi-k2.6 cross-channel todo extraction via CF AI Gateway with per-employee daily caps + prompt caching — *verified 2026-05-19*
- [x] **IMESSAGE-BRIDGE**: BlueBubbles on HostMyApple Mac mini + Cloudflare Tunnel — *verified 2026-05-19*
- [x] **AGENTIC-INBOX**: Maya MCP Worker at agent.internjobs.ai + R2 attachments + CF Access SSO — *verified 2026-05-19*
- [x] **LINK-ENRICH-QR**: Bright Data LinkedIn enrichment + Standout-style QR onboarding — *verified 2026-05-19*
- [x] **DAILY-CO**: Per-employee always-on personal rooms + ephemeral StartMeeting CTA — *verified 2026-05-19*
- [x] **MATTERMOST-OIDC**: Mattermost OIDC SSO bridge via Workspace `/oidc/*` (code; activation in v1.4 C1) — *code verified 2026-05-19*
- [x] **ADMIN-INVITE**: Admin invite UX with capability toggles + phone-OTP + warm welcome email (backend) — *verified 2026-05-19*

### v1.3 — Pilot Hardening (shipped 2026-05-19 / partial, closed 2026-05-24)

**Graph Bridge (Phase 18) — shipped:**
- [x] **GRAPH-PROXY-01..05**: `internjobs-graph-api` Fly app + `infra/graph-api/` directory + `POST /query` + `GRAPH_API_SECRET` in Infisical + `FALKORDB_*` removed from Workspace Worker — *verified 2026-05-19 (commits be38369, 3449299, 1664d67, 1d13b1d)*
- [x] **GRAPH-WORKER-01..03**: Workspace Worker `graph.ts` rewired to HTTP transport + types updated + `/healthz` dual-readiness — *verified 2026-05-19*
- [x] **GRAPH-VERIFY-01..03**: Production smoke test (`smoke:parrot-graph`) passes; `graph_context_injected` log emitted on inbound — *verified 2026-05-19*

**Todo Auto-Resolution (Phase 19) — partial (infra ✓, writer carried into v1.4 A1):**
- [x] **AUTO-CLEAR-01..08**: cron `*/5 * * * *` + scheduled handler + minimum-open-window guard + DO migration 8 + `resolveTodo`/`unresolveTodo` RPCs + Resolved view route + Undo route — *verified 2026-05-19 (commits 6415650, 218d879, d03ff15, cdbc8ab)*
- [x] **AUTO-CLEAR-UX-01..05**: Resolved nav item + animate-out + Agent pill + Undo + first-clear toast — *verified 2026-05-19*
- [x] **AUTO-CLEAR-VERIFY-01**: cross-namespace Cypher smoke test — *verified 2026-05-19*
- ⚠️ **AUTO-CLEAR-VERIFY-02**: end-to-end auto-clear flow — **carried into v1.4 CLOSETODO-03** (no `closeTodoFact` writer exists, so cron has nothing to find)

**Pre-LLM Safety Screening (Phase 20) — code ✓, verification carried into v1.4 A2/A3:**
- [x] **SAFETY-LAKERA-02**: `LAKERA_GUARD_API_KEY` deployed to Fly student app + Workspace Worker — *verified 2026-05-19*
- ⚠️ **SAFETY-LAKERA-01**: account provisioning + v2 endpoint verification — **carried into v1.4 LAKERA-V2-01/02/03**
- [x] **SAFETY-NODE-01, SAFETY-WORKER-01**: `screen.mjs` + `safety.ts` helpers with 1s timeout, fail-open — *verified 2026-05-19 (commits fd24477)*
- [x] **SAFETY-INSERT-01..02**: screen gate in `server.mjs` (SMS) + `inbound-email.ts` (Workspace email) — *verified 2026-05-19 (commit 6f33854)*
- [x] **SAFETY-SCOPE-01..02**: Mattermost ingest + known startup_members senders bypass Lakera — *verified 2026-05-19*
- [x] **SAFETY-POLICY-01..03**: hard-block / soft-flag / fail-open policy implemented — *verified 2026-05-19*
- [x] **SAFETY-RESPONSE-01..02**: SMS hard-block canned reply + email hard-block silent — *verified 2026-05-19*
- [x] **SAFETY-LOG-01**: `safety_events` table — migration 0009 applied — *verified 2026-05-19 (commit 30ca491); table moved from Neon → student-app Postgres on 2026-05-21*
- [x] **SAFETY-VIEW-01**: `/api/ops/safety` route + `/ops/safety` React view — *verified 2026-05-19*
- [x] **SAFETY-BADGE-01**: red-dot badge for unreviewed flags within 24h — *verified 2026-05-19*
- ⚠️ **SAFETY-VERIFY-01..03**: 3 production-path tests (injection / benign / fail-open) — **carried into v1.4 SAFETY-VERIFY-LIVE-01..04**

**Credential Rotation (Phase 21) — deferred:**
- — **SEC-ROTATE-ALL**: sole-user deferral at user direction (2026-05-19). RUNBOOK preserved at `.planning/milestones/v1.3-pilot-hardening/phases/21-credential-rotation/RUNBOOK.md`. **Reopens when first pilot user is identifiable** — see v1.5 Candidates.

### Un-roadmapped (shipped 2026-05-21) — Neon-exit

- [x] **NEON-EXIT-MM**: Mattermost DB migrated to self-hosted Fly Postgres `internjobs-mattermost-db` — *verified 2026-05-21 (commit 729832b)*
- [x] **NEON-EXIT-STUDENT**: Student app DB migrated to self-hosted Fly Postgres `internjobs-student-db` (pgvector + HNSW preserved; 60 tables / 108 audit / 2 students / 18 inbound / 16 safety rows verified identical post-pg_restore) — *verified 2026-05-21 (commit 8983104)*
- [x] **NEON-EXIT-API**: Workspace Worker decoupled from Postgres via new student-app `/internal/safety-events` Bearer API — *code verified 2026-05-21 (commit 8983104; end-to-end verification carried into v1.4 B1)*
- [x] **NEON-EXIT-DELETE**: All 3 Neon projects deleted (`noisy-rain-23196137`, `flat-scene-36951468`, `soft-dust-92209989`) — *confirmed 2026-05-21 per `infra/NEON-EXIT.md`*

### Un-roadmapped (shipped 2026-05-22..24) — Workspace agent-lift

- [x] **AGENT-LIFT-CODE**: AgentPanel + MCPPanel + EmailPanel + email-sender + agent-tools + agent routes lifted from `apps/agentic-inbox/` into `apps/parrot/` — *verified code 2026-05-24 (commits a77ec48, 52ad5fc, 0808631, c1da1fa, f4be90c, 389935a, d501897, 3791513). UAT carried into v1.4 A5.*
- [x] **CHAT-EMAIL-NATIVE**: `/chat` and `/inbox` rendered as native Workspace surfaces (no external app iframe) — *verified 2026-05-24 (commit 23b0e58)*
- [x] **MM-WHITELABEL**: Mattermost CSP-rewriting proxy + white-label CSS injection live at `chat.internjobs.ai` — *verified 2026-05-24 (commits e1468ec, f7e4272)*
- [x] **LINKEDIN-URL-INVARIANT**: Student QR/START-code creation requires valid LinkedIn URL; phone claims immutable per LinkedIn identity; Bright Data enrichment on `/onboard/start` and START-code webhook — *verified 2026-05-24 (commits 26ee577, 0e7cb29, 930c758, 46cbc25, c83098c, b3e349d)*

## v1.4 — Pilot Readiness (Active)

Close v1.3's dangling work and the un-roadmapped initiatives that landed after v1.3 ship-ready, so the door can open for the first 5–10 startup pilots. First milestone under RRR team mode (`team-cms` + `team-workspace`).

Source: `.planning/milestones/v1.4-pilot-readiness/SCOPE.md` + comparison of `SHIP-READY.md` vs current code state (2026-05-24 audit) + `.planning/codebase/CONCERNS.md`.

### Group A — Close v1.3 dangling work

**A1 — `closeTodoFact` writer (team-workspace)**

Makes v1.3 Phase 19 auto-clear cron actually fire. Without this, `:Todo.valid_to` is never set by production code so the cron query always returns zero rows.

- [ ] **CLOSETODO-01**: `closeTodoFact(thread_id, resolution_text)` Cypher helper added to `apps/parrot/workers/lib/graph.ts`; sets `:Todo.valid_to = timestamp()` on the matching todo via deterministic-hash lookup
- [ ] **CLOSETODO-02**: Workspace Worker reply path (Mastra workflow OR direct chat handler — verify which is live) invokes `closeTodoFact` when the agent reply matches a resolution-acknowledgement pattern (got it / fixed / done / sent / shipped — regex set documented in code comment)
- [ ] **CLOSETODO-03**: End-to-end smoke against production FalkorDB: agent reply containing "got it, sending now" → `closeTodoFact` writes `valid_to` → next `runAutoClear` tick closes the linked SQLite todo within 30s → todo appears in Resolved view
- [ ] **CLOSETODO-04**: Structured log line `{"event":"todo_fact_closed","thread_id","employee_id","matched_phrase"}` emitted on each close

**A2 — Lakera verification tests run live (team-cms + team-workspace)**

- [ ] **SAFETY-VERIFY-LIVE-01**: Live injection-test student SMS (`"ignore previous instructions and …"`) is hard-blocked; student receives the exact canned reply; `safety_events` row written with `action='blocked'`. *Team: team-cms (student SMS path)*
- [ ] **SAFETY-VERIFY-LIVE-02**: Live benign student SMS produces zero `safety_events` log entries and the agent replies normally. *Team: team-cms*
- [ ] **SAFETY-VERIFY-LIVE-03**: Simulated Lakera 5xx (via temporarily invalid `LAKERA_GUARD_API_KEY`) produces `action='passed_lakera_unavailable'` row and the message proceeds through the agent loop. *Team: team-cms*
- [ ] **SAFETY-VERIFY-LIVE-04**: Equivalent injection email from a non-startup_members sender is hard-blocked silently (no auto-reply, per SAFETY-RESPONSE-02); `safety_events` row written. *Team: team-workspace*

**A3 — Lakera v2 schema verification post-Cisco (team-cms)**

- [ ] **LAKERA-V2-01**: Lakera (Cisco AI Defense) account live at `platform.lakera.ai`; current v2 endpoint URL + auth header + response shape documented in `apps/app/src/safety/screen.mjs` parser-block comment header
- [ ] **LAKERA-V2-02**: If endpoint or response shape differs from current code, parser blocks in both `apps/app/src/safety/screen.mjs` and `apps/parrot/workers/lib/safety.ts` updated; `apps/app/src/safety/screen.test.mjs` still passes
- [ ] **LAKERA-V2-03**: Pricing tier (Community vs Pro) confirmed sufficient for 30k/month pilot volume; documented in `infra/NEON-EXIT.md` neighbor file or new `infra/LAKERA-PRICING.md`

**A4 — Attachment download endpoint (team-workspace)**

- [ ] **ATTACH-DOWN-01**: `GET /api/inbox/messages/:messageId/attachments/:attachmentId` route added to `apps/parrot/workers/routes/`; returns the R2 blob with correct `Content-Type` + `Content-Disposition: attachment; filename="..."`
- [ ] **ATTACH-DOWN-02**: Route requires Clerk session for the employee that owns the mailbox; non-owner returns 403; missing attachment returns 404
- [ ] **ATTACH-DOWN-03**: `EmailPanel` attachment metadata links wire to this route; clicking a rendered attachment downloads the file in Chrome + Safari

**A5 — Authenticated UAT for agent-lift (team-workspace)**

- [ ] **AGENT-UAT-01**: All 14 steps in `.planning/milestones/v1.3-pilot-hardening/phases/19-todo-auto-resolution/V1_3_1-AGENT-LIFT-REPORT.md` pass with a fresh Workspace Clerk OTP session
- [ ] **AGENT-UAT-02**: AgentPanel quick actions (summarize, draft, translate) all return live LLM results in production within 10s
- [ ] **AGENT-UAT-03**: MCPPanel lists all 11 MCP tools and at least 3 tool calls return non-error responses

### Group B — Neon-exit closeout

**B1 — End-to-end safety_events API verification (team-cms owns API, team-workspace validates callsite)**

- [ ] **NEONEX-VER-01**: Live Lakera-blocked inbound triggers successful `POST /internal/safety-events` from Workspace Worker to student-app with valid Bearer `INTERNAL_API_SECRET`/`STUDENT_API_SECRET`
- [ ] **NEONEX-VER-02**: `/ops/safety` in Workspace renders the resulting row by reading from student-app's `GET /internal/safety-events`
- [ ] **NEONEX-VER-03**: Bearer secret mismatch returns 401; student app logs the failed attempt without crashing; Workspace `/ops/safety` falls back gracefully (does not throw)
- [ ] **NEONEX-VER-04**: `safety_events_unreviewed_count` badge in Workspace updates correctly after Neon-exit (reads via `GET /internal/safety-events/unreviewed-count`)

**B2 — Dependency cleanup (team-workspace)**

- [ ] **NEONEX-DEP-01**: `@neondatabase/serverless` removed from `apps/parrot/package.json` + `package-lock.json`; `npm run build` in `apps/parrot/` still passes; `grep -r "@neondatabase" apps/parrot/workers/` returns zero results

**B3 — Documentation refresh (team-cms coordinator role)**

- [ ] **NEONEX-DOC-01**: `.planning/HANDOFF.md` §4 "One Neon database for everything" claim corrected
- [ ] **NEONEX-DOC-02**: `.planning/ROADMAP.md` adds historical note: "Neon-exit shipped 2026-05-21 (un-roadmapped during v1.3)"
- [ ] **NEONEX-DOC-03**: `infisical-project` memory note (or new `infra-secrets-topology` note) updated with current secrets: `DATABASE_URL`, `INTERNAL_API_SECRET`, `STUDENT_API_SECRET`, `POSTGRES_PASSWORD`, `STUDENT_DB_PASSWORD`

### Group C — v1.3 carryovers + Workspace upgrades

**C1 — Mattermost OIDC SSO activation (team-workspace)**

OIDC bridge code already shipped at `apps/parrot/workers/routes/oidc.ts` + WorkspaceDO tables. This is a config-only activation.

- [ ] **MMSSO-01**: `mmctl` one-shot run sets `GitLabSettings.{Enable,Id,Secret,AuthEndpoint,TokenEndpoint,UserApiEndpoint}` pointing at `https://workspace.internjobs.ai/oidc/*`
- [ ] **MMSSO-02**: User signing into `chat.internjobs.ai` clicks the "GitLab" button → bounces through `workspace.internjobs.ai/oidc/*` → lands signed in to Mattermost in <5s
- [ ] **MMSSO-03**: New employee (invited via admin invite UX) auto-provisions a Mattermost user via the OIDC userinfo response on first sign-in

**C2 — Knowledge graph reuse for Workspace agent (team-workspace)**

Biggest agent-quality win. Unblocked by v1.3 Phase 18 (graph proxy is live). Same FalkorDB instance, separate `:Employee` namespace.

- [ ] **KGRAPH-01**: Workspace Worker `graph.ts` gains `:Employee`-namespace Cypher: `getEmployeeContext(employee_id, window_days)` returns top-N active todos + recent mentions across channels
- [ ] **KGRAPH-02**: Dashboard agent extraction (kimi-k2.6) pre-LLM injection prepends `getEmployeeContext` result as the first block of the extraction prompt
- [ ] **KGRAPH-03**: Post-extraction fire-and-forget writes new `:Todo` + `:MENTIONS` + `:BLOCKED_BY` edges into the `:Employee` namespace
- [ ] **KGRAPH-04**: Cross-namespace isolation verified — `:Employee` queries return zero `:Student` nodes and vice versa (smoke test)
- [ ] **KGRAPH-05**: A/B comparison on 10 real extractions shows context-augmented extraction reduces duplicate-todo creation rate (qualitative pass acceptable for v1.4; quantitative metric deferred to v1.5)

**C3 — Admin invite UX gaps (team-workspace)**

- [ ] **ADMIN-UX-01**: `/admin` frontend page (Ridhi `role=ceo` only) lists employees with editable capability toggles (email, chat, meetings, phone, sms, campaigns)
- [ ] **ADMIN-UX-02**: Toggle change writes to `profile.feature_flags` JSON via `PATCH /api/admin/employees/:id`; UI reflects new state without page refresh
- [ ] **ADMIN-UX-03**: Invite form has FN / LN / personal_email / phone fields; submit creates Clerk phone-OTP user + CF Email Routing rule + WorkspaceDO row in one transaction
- [ ] **ADMIN-UX-04**: Personalized welcome email sent from Ridhi (FROM `raj@internjobs.ai` SUBJECT-prefixed "Welcome to InternJobs") with workspace mission + phone-login instructions (no static template — interpolates employee name + workspace email)

**C4 — GenZ chat polish (team-workspace)**

- [ ] **GENZ-01**: Mattermost GIF/sticker plugin enabled in self-hosted Mattermost config (`mmctl plugin add`); Tenor or GIPHY integration live and reachable from chat composer
- [ ] **GENZ-02**: `canvas-confetti` library added to Workspace UI; micro-animations trigger on first-todo-cleared + 5-emails-responded-today events
- [ ] **GENZ-03**: Parrot-mascot branded loading state replaces the generic spinner on dashboard data fetch

### Group D — Polish (lower priority; may slip to v1.5)

- [ ] **DAILY-THEME-01**: Campus Aurora palette applied to Daily.co Prebuilt via `console.daily.co` dashboard config (no code path); accent `#7C3AED`, bg `#FAFAFA`, slate text/border; verified in `/meetings` iframe. *Team: team-workspace*
- [ ] **STAR-API-01**: `PATCH /api/inbox/messages/:id` with `{starred: bool}` persists to mailbox DO; `EmailPanel` star icon toggles visible state. *Team: team-workspace*
- [ ] **DATES-01**: `formatQuotedDate` callers in `apps/agentic-inbox/` + `apps/parrot/` migrated to `packages/shared/src/dates`; 3 `@deprecated` re-exports deleted. *Shared (both teams)*

### Group E — Test floor

- [ ] **WSTEST-01**: Vitest harness added to `apps/parrot/workers/`; smoke test for `/healthz` returning expected JSON shape with all readiness keys. *Team: team-workspace*
- [ ] **WSTEST-02**: One happy-path smoke test per Worker route file in `apps/parrot/workers/routes/` (return 200 with expected shape). *Team: team-workspace*
- [ ] **WSTEST-03**: `npm test` in `apps/parrot/` documented in README; ideally wired to GitHub Actions on `rrr/v1.4/team-workspace` branch. *Team: team-workspace*

## Future Milestones

Candidates flagged by v1.3 + v1.4 work but not in v1.4 roadmap.

### v1.5 Candidates

*Re-evaluate after v1.4 ships + first 5–10 pilots run for a week*

- **SEC-ROTATE-ALL** — All 5 token families (Clerk x2 + CF Email + CF AI + broad CF) rotated. Reopens from v1.3 Phase 21 when first pilot user is identifiable. RUNBOOK already exists.
- **DAILY-VANITY-01** — Custom Daily.co subdomain `meet.internjobs.ai`. Defer until external-share volume justifies Scale-plan upgrade.
- **AGENTIC-INBOX-TESTS** — Test coverage for `apps/agentic-inbox/workers/` (currently zero `.test.ts` files).
- **INTEG-01-PROD-RUN** — INTEG-01 11-step two-sided smoke executed end-to-end in production by a human operator (never run since v1.2).
- **SAFETY-OUTBOUND-01** — Lakera Guard on agent outbound messages (gate: first pilot report of an agent message causing reputational harm).
- **SAFETY-HARD-BLOCK-EXPAND-01** — Convert student SMS soft-flag → hard-block once 30 days of pilot FP-rate data exists.
- **MAC-BRIDGE-ALERTING** — Monitor `mac-bridge` `/healthz`; alert when BlueBubbles process or Cloudflare Tunnel goes down silently.
- **WORKERS-VPC-REVISIT** — If Workers VPC reaches GA with viable pricing, retire `internjobs-graph-api` Fly proxy in favor of native CF service binding.
- **KGRAPH-METRICS** — Quantitative metric on duplicate-todo-rate reduction from KGRAPH-05 (qualitative pass in v1.4).
- **PARROT-NAME-AUDIT** — Decide whether to rename `apps/parrot/` → `apps/workspace/` (lift the historical naming; would require Worker rename + deploy + docs sweep).

### Backlog (Unassigned)

- **TELNYX-ADAPT-01 / TELNYX-MIGRATE-01 / SUNSET-01** — Telnyx SMS adapter migration; A2P 10DLC registration takes weeks (still regulatory-gated).
- **STORAGE-02** — Email + MMS attachment ingest into R2 (Workspace side; A4 above is just the download endpoint, not the ingest pipeline).
- **STORAGE-03** — Permanent short links via mapping bucket + redirector Worker.
- **EMAIL-04** — Per-startup vanity addresses (`acme@internjobs.ai`).
- **STARTUP-SMS-01** — Second SMS number for startup-side messaging.
- **CONSENT-INFER-01** — `agent_inference_consent` on the consents table.
- **FEEDBACK-LOOP-01** — Automated draft feedback loop into prompt tuning.
- **THREAD-SUMMARY-01** — Background summarizer for long Mastra threads.
- **MULTI-MEMBER-01** — Multi-member startup invites.
- **COGNEE-ACTIVATE-01** — Activate Cognee placeholders (legal-gated).
- **ENRICH-ACTIVATE-01** — Activate Sprite.dev + Bright Data deeper enrichment (legal-gated).
- **VOICE-01** — Voice channel (demand-gated on >10% inbound voice asks).
- **SLACK-01** — Slack integration for startups (demand-gated).

## Out of Scope

| Feature | Reason | Revisit? |
|---------|--------|----------|
| LinkedIn credential capture or login scraping | High legal/security risk | Never |
| Automated private LinkedIn scraping | Likely violates platform expectations | Only after legal review + approved API path |
| Replacing the marketing site with the app | Marketing remains static CF Pages | Never |
| ATS or recruiter dashboard | Wrong product feel — app stays messaging-first | Never |
| Telnyx activation in v1.4 | A2P 10DLC registration still external-gated | When regulatory window opens |
| Cognee activation in v1.4 | Legal-gated | When legal cleared |
| Sprite.dev + Bright Data deeper activation in v1.4 | Legal-gated | When legal cleared |
| STORAGE-02 ingest pipeline / STORAGE-03 / EMAIL-04 / DAILY-VANITY-01 in v1.4 | Pilot polish, not pilot-blocking | v1.5 |
| Voice channel (any provider) | Demand-gated | When >10% inbound asks for voice |
| Slack integration for startups | Demand-gated | When first 5-10 startups prefer Slack |
| 2nd SMS number for startup-side SMS | Demand-gated | When startup feedback shows email insufficient |
| Outbound message safety screening | System-prompt guardrails cover v1.4 scale | After pilot harm event or v1.5 |
| Rotating Clerk JWT Signing Keys in SEC-ROTATE | Mass user sign-out across both apps | Only on confirmed signing-key compromise |
| Workers-native RESP3 client for FalkorDB | `cloudflare:sockets` blocks private IPs + no Cypher lib | When Workers VPC reaches GA |
| Renaming `apps/parrot/` → `apps/workspace/` in v1.4 | Heavy refactor for cosmetic naming; verbal/written reference already standardized to "Workspace" via `project-app-naming` memory | v1.5 candidate (PARROT-NAME-AUDIT) |
| Mac bridge HA / multi-Mac failover | Single-Mac-mini risk accepted for pilot scale | Post-pilot if iMessage uptime becomes a complaint |
| Mastra framework upgrade | Pre-1.0; pin and watch — upgrade only on a confirmed need | Per-release evaluation |

## Traceability

To be populated by `/rrr:create-roadmap`. Each Active v1.4 requirement maps to exactly one phase.

| Requirement | Phase | Team | Status |
|-------------|-------|------|--------|
| CLOSETODO-01..04 | TBD | team-workspace | Pending |
| SAFETY-VERIFY-LIVE-01..03 | TBD | team-cms | Pending |
| SAFETY-VERIFY-LIVE-04 | TBD | team-workspace | Pending |
| LAKERA-V2-01..03 | TBD | team-cms | Pending |
| ATTACH-DOWN-01..03 | TBD | team-workspace | Pending |
| AGENT-UAT-01..03 | TBD | team-workspace | Pending |
| NEONEX-VER-01..04 | TBD | team-cms / team-workspace | Pending |
| NEONEX-DEP-01 | TBD | team-workspace | Pending |
| NEONEX-DOC-01..03 | TBD | team-cms | Pending |
| MMSSO-01..03 | TBD | team-workspace | Pending |
| KGRAPH-01..05 | TBD | team-workspace | Pending |
| ADMIN-UX-01..04 | TBD | team-workspace | Pending |
| GENZ-01..03 | TBD | team-workspace | Pending |
| DAILY-THEME-01 | TBD | team-workspace | Pending |
| STAR-API-01 | TBD | team-workspace | Pending |
| DATES-01 | TBD | shared | Pending |
| WSTEST-01..03 | TBD | team-workspace | Pending |

**Coverage (v1.4):**
- Active requirements: 39 total (4 closeTodo + 4 safety-verify + 3 lakera-v2 + 3 attach + 3 agent-uat + 4 neonex-ver + 1 dep + 3 docs + 3 sso + 5 kgraph + 4 admin + 3 genz + 3 polish + 3 tests)
- Mapped to phases: 0 ⚠️ (pending `/rrr:create-roadmap`)
- Unmapped: 39 ⚠️

**Team split:**
- team-cms: 9 requirements (LAKERA-V2 + SAFETY-VERIFY-LIVE-01..03 + NEONEX-VER + NEONEX-DOC, plus shared role on NEONEX-VER)
- team-workspace: 27 requirements (Group A workspace items + Neon-exit dep cleanup + all of C + all of D except DATES + all of E + SAFETY-VERIFY-LIVE-04)
- shared: 3 requirements (NEONEX-VER end-to-end + DATES-01 cross-app cleanup)

---
*Requirements defined: 2026-05-19 (v1.3)*
*Last updated: 2026-05-24 — v1.4 milestone defined. v1.3 moved to Validated with carryover refs (SAFETY-LAKERA-01 → LAKERA-V2-*, SAFETY-VERIFY-01..03 → SAFETY-VERIFY-LIVE-*, AUTO-CLEAR-VERIFY-02 → CLOSETODO-03). Neon-exit + agent-lift un-roadmapped items added to Validated. v1.4 Active = 39 requirements across Groups A (5 closeouts), B (3 Neon-exit closeout), C (4 carryovers + Workspace upgrades), D (3 polish), E (1 test floor) — pre-assigned to team-cms / team-workspace. SEC-ROTATE deferred to v1.5 Candidates. First milestone under RRR team mode.*
