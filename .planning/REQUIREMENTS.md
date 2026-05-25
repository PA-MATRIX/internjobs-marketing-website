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

### Group G — Startup MCP Server + Channel-Adapter Core (Phase 28, team-cms)

First scalable channel for startup-initiated interaction with internjobs.ai. Stainless-style `search` + `execute` + `me` + `discover_actions` MCP surface — reaches every startup founder using Claude Desktop / Claude Code / Cursor / Cline / ChatGPT (all MCP-native by 2026). Ridhi handles concierge onboarding for first 5–10 pilots via admin endpoint that SMS-sends the MCP install link. Channel-adapter pattern + `startup_channel_links` schema future-proof Phase 29 (Telnyx) and v1.5 (Slack/Discord/Teams) as ~50–100 LOC adapters on the same core.

**MCP surface (4 tools total):**

- [ ] **STARTUP-MCP-01**: `apps/startup-mcp/` Cloudflare Worker MCP server scaffold; deploys to `mcp.internjobs.ai`; MCP handshake (protocol version, capabilities, server metadata per spec)
- [ ] **STARTUP-MCP-02**: Bearer-token auth — per-startup install tokens issued at onboarding; rotated via internal student-app `/internal/*` API surface
- [ ] **STARTUP-MCP-03**: `me()` tool — constant-time identity lookup; returns `{startup, member, role_count, recent_activity}`
- [ ] **STARTUP-MCP-04**: `discover_actions()` tool — returns available action names + JSON schemas + descriptions (Stainless `list_api_endpoints` pattern; LLM grounding without preload bloat)
- [ ] **STARTUP-MCP-05**: `search(scope, query, filters?)` tool — universal read; scope ∈ {`roles`, `candidates`, `threads`, `messages`, `members`, `startups`}; semantic via pgvector + structured filter; returns ID + summary list
- [ ] **STARTUP-MCP-06**: `execute(action, params)` tool — universal write; action is ENUM (not free-form string) → per-action authz + per-action audit log row; per-action handler with schema validation; result envelope `{ok, data?, error?}`

**5 action handlers (v1 enum):**

- [ ] **STARTUP-MCP-07**: `execute('post_role', {role_spec})` handler — writes to `roles` table; semantic-indexes role description via pgvector for candidate matching
- [ ] **STARTUP-MCP-08**: `execute('reply_to_candidate', {thread_id, message})` handler — writes to existing `inbound_messages` / `outbound_messages` schema (channel='mcp'); preserves single conversation log across all channels — no fragmentation
- [ ] **STARTUP-MCP-09**: `execute('update_role', {role_id, patch})`, `execute('archive_role', {role_id})`, `execute('mark_candidate', {thread_id, mark})` — 3 more handlers per the v1 enum

**Per-action authz + audit:**

- [ ] **STARTUP-MCP-10**: Per-action audit log row in `startup_action_log` table (member_id, channel='mcp', action, params_hash, status, latency_ms, created_at); per-action authorization checks actor's `startup_members.role` + ownership boundary (no cross-startup data leak; negative-test verified)

**Concierge admin onboarding (Ridhi-managed for pilot):**

- [ ] **STARTUP-ADMIN-01**: `POST /admin/startups/new({company, founder_email, founder_phone})` endpoint — auth-protected (Ridhi only); inserts `startups` + `startup_members` rows + generates per-startup MCP install token
- [ ] **STARTUP-ADMIN-02**: Admin endpoint SMS-sends the install snippet to the founder's phone via Telnyx/Spectrum: `claude mcp add --transport http internjobs https://mcp.internjobs.ai/mcp --header "Authorization: Bearer {TOKEN}"` (token in Authorization header per Phase 28 research — URL-path tokens leak in CF access logs). Same shape works for Cursor + Cline + ChatGPT GPT-5.

**Channel-adapter schema + docs:**

- [ ] **STARTUP-CHANNEL-01**: `startup_channel_links` table schema — `(id, startup_id, member_id, channel_type, channel_external_id, status, opt_in_flags, created_at)`. Enables Phase 29 (channel_type='telnyx-sms' or 'telnyx-voice') + v1.5 (channel_type='slack' or 'discord' or 'teams') identity mapping without core code change
- [ ] **STARTUP-CHANNEL-02**: `apps/startup-mcp/CHANNELS.md` — architecture doc showing how Phase 29 (Telnyx) + v1.5 (Slack/Discord/Teams) plug in as thin adapters on the same `search`/`execute`/`me` core. Concrete pattern + ~50–100 LOC adapter sketch per channel.

**Marketing + pilot:**

- [ ] **STARTUP-MARKETING-01**: `/startups` marketing page CTA block — "Request access — we'll text you the install" form that emails Ridhi the founder's name + email + phone + what they're hiring for. (No self-serve install page in Phase 28; deferred to v1.5.)
- [ ] **STARTUP-MARKETING-02**: `/startups` marketing page "how we work with you" section — visual grid presenting the channel options with brand-correct hierarchy. **Primary tier (highlighted):** Claude / ChatGPT / Cursor (via MCP install), Voice (call our Telnyx number), SMS (text our number), Email (always-on). **Coming soon tier (greyed/labeled):** Slack, Discord, Microsoft Teams. Copy emphasizes "talk to us where you already work" — no forced platform choice. Brand voice (lowercase, blunt, "no resumes" pattern) per BRAND-V1.md. Each primary tier item has a one-line "how it works" subhead.
- [ ] **STARTUP-PILOT-01**: First pilot startup onboards end-to-end (Ridhi runs admin endpoint → founder receives SMS → founder pastes install command into Claude/Cursor/ChatGPT → calls `me()` → calls `execute('post_role')` → calls `search('candidates')` → calls `execute('reply_to_candidate')`); evidence committed to `.planning/milestones/v1.4-pilot-readiness/phases/28-startup-mcp-server/PILOT-EVIDENCE.md`


### Group G2 — Startups Web App + Clerk #3 + Per-Startup Agent Email (Phase 28.5, team-cms)

Third leg of the auth tripod: a founder-facing Vite+React portal at `startups.internjobs.ai` (Clerk app #3, Google OAuth + work-email magic-link), per-startup agent email addresses (`<slug>@startups.internjobs.ai`), and a Cloudflare Email Routing catch-all → Worker for inbound email threading. Founders can self-serve sign in (no Claude/Cursor needed), post roles, view candidate threads, and send replies from their agent address. Ridhi's concierge admin endpoint extended to mint Clerk invites + reserve agent slugs + send welcome emails. Marketing `/startups` CTA flipped from "request access" to "sign up".

**Auth + web app:**

- [ ] **STARTUP-WEB-AUTH-01**: Clerk app #3 "InternJobs Startups" created; mounted in `apps/startups/` via `@clerk/react` `ClerkProvider`; Google OAuth + email magic-link enabled; `STARTUPS_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `STARTUPS_CLERK_SECRET_KEY` in Infisical at `/internjobs-ai` env=prod
- [ ] **STARTUP-WEB-AUTH-02**: `startups.internjobs.ai` resolves with valid TLS; Google OAuth sign-in and email magic-link both complete end-to-end; authenticated session lands on `/dashboard`
- [ ] **STARTUP-WEB-AUTH-03**: Work-email enforcement active: sign-up attempt from gmail.com / yahoo.com / hotmail.com / outlook.com / icloud.com / aol.com / proton.me / live.com / msn.com / googlemail.com / gmx.* is rejected (Clerk `user.created` webhook + `deleteUser` call); custom-domain sign-up succeeds
- [ ] **STARTUP-WEB-AUTH-04**: Clerk webhook at `https://mcp.internjobs.ai/webhooks/clerk` verified with Svix signature; `STARTUPS_CLERK_WEBHOOK_SECRET` in Infisical; unauthorized requests return 400

**Dashboard + role/thread UX:**

- [ ] **STARTUP-WEB-DASH-01**: Authenticated founder lands on `/dashboard` showing startup name, agent email address, role count, and recent candidate threads — all from live `/api/me` response via Pages Function proxy
- [ ] **STARTUP-WEB-DASH-02**: Founder can create a new role at `/roles/new` → row appears in `roles` table with the identical column set as MCP `execute('post_role')` — no schema fragmentation; `title`, `description`, `location`, `employment_type` fields match exactly
- [ ] **STARTUP-WEB-DASH-03**: Founder can open a candidate thread and send a reply → outbound email goes FROM `<slug>@startups.internjobs.ai`; candidate sees that as the From address

**Per-startup agent email:**

- [ ] **STARTUP-AGENT-EMAIL-01**: Migration 0013 applied: `startups.agent_email TEXT UNIQUE` column exists; slug algorithm (`mintSlug` + `reserveUniqueSlug` with 10-attempt collision guard) implemented in `apps/startup/workers/lib/slug.ts`; each startup provisioned with `<slug>@startups.internjobs.ai` at creation time
- [ ] **STARTUP-AGENT-EMAIL-02**: CF Email Routing catch-all for `startups.internjobs.ai` → `internjobs-startups` Worker; `email()` export on Worker resolves slug via `startup_channel_links` → inserts `inbound_messages` row with `channel='email'` and correct `(startup_id, member_id)`; unknown slug returns `setReject('startup not found')`
- [ ] **STARTUP-AGENT-EMAIL-03**: Outbound email via `env.EMAIL.send()` CF binding uses `from: '<slug>@startups.internjobs.ai'`; SPF + DKIM + DMARC records on `startups.internjobs.ai` verified in CF Email Routing; `welcome@startups.internjobs.ai` send-from verified
- [ ] **STARTUP-AGENT-EMAIL-04**: Phase 28 `POST /admin/startups/new` extended: mints slug + sets `agent_email` + inserts `startup_channel_links` row + sends Clerk invite to founder email + sends welcome email FROM `welcome@startups.internjobs.ai`

**Marketing CTA:**

- [ ] **STARTUP-WEB-CTA-01**: `/startups` marketing page CTA updated from "request access" form → "sign up →" anchor linking to `https://startups.internjobs.ai/`; cobalt accent preserved per BRAND-V1.md; copy: "create your account in 60 seconds" (lowercase)

**Work-email enforcement:**

- [ ] **STARTUP-WORK-EMAIL-01**: `POST /webhooks/clerk` handler in `apps/startup/` Worker with Svix HMAC-SHA256 verification; `user.created` event triggers `isPersonalEmail()` check; personal-domain users deleted via `DELETE /v1/users/:id` with `STARTUPS_CLERK_SECRET_KEY`; code comment documenting v1.5 upgrade path to Clerk paid-tier native blocklist


### Group H — Startup Telnyx SMS + Voice AI + Voice-Based Onboarding (Phase 29, team-cms)

The "feel heard, no work" channel for non-tech / non-MCP startup founders. Toll-free Telnyx number (skips A2P 10DLC wait), SMS inbound webhook routing to MCP `execute()`, Telnyx Voice AI Agent configured to call our MCP tools directly, voice-intake onboarding flow ("call → activated in 30 seconds"), weekly text touchbase scheduled task. Builds on Phase 28's `startup_channel_links` + MCP core.

**Telnyx number + SMS:**

- [ ] **STARTUP-TELNYX-01**: Provision Telnyx toll-free number (skips A2P 10DLC ~4-week registration); store as `STARTUP_TELNYX_NUMBER` in Infisical; document migration path to A2P 10DLC local number in v1.5 candidates
- [ ] **STARTUP-TELNYX-02**: Telnyx SMS inbound webhook → CF Worker handler at `apps/startup-mcp/` (new adapter) → identity resolution via `startup_channel_links` (channel_type='telnyx-sms', channel_external_id=from_phone)
- [ ] **STARTUP-TELNYX-03**: SMS intent classifier — small LLM call that maps natural-language SMS body to an action enum (`search('candidates', q)` / `execute('reply_to_candidate', ...)` / `execute('show_candidate', {position})` / etc); fall-through to a clarification prompt for ambiguous text
- [ ] **STARTUP-TELNYX-04**: SMS outbound via Telnyx REST API — responses + scheduled touchbase messages; 160-char chunking for long content; brand voice (lowercase, blunt, fast — same AGENT-VOICE rules from v1.2)
- [ ] **STARTUP-TELNYX-05**: SMS opt-out — `STOP` / `UNSUBSCRIBE` reply parsed by webhook → flips `startup_channel_links.opt_in_flags`; confirmation reply; legal compliance per TCPA
- [ ] **STARTUP-TELNYX-06**: SMS audit log — each inbound + outbound row written to `startup_action_log` (channel='telnyx-sms')

**Voice AI agent + voice-intake onboarding:**

- [ ] **STARTUP-VOICE-01**: Telnyx Voice AI Agent provisioned and configured to call our MCP server tools directly (zero custom voice code; Telnyx handles TTS, STT, intent, tool calling). Auth via per-agent MCP token.
- [ ] **STARTUP-VOICE-02**: Voice-intake onboarding script — greeting ("hey, this is internjobs — i'll get you set up in 30 seconds") → 4 questions (company_name, founder_name, work_email, what hiring for) → calls `execute('register_startup', {...})` → confirms via SMS install link
- [ ] **STARTUP-VOICE-03**: Voice call recordings + transcripts logged to R2 (per-startup folder) for audit; opt-in disclosure in voice greeting per applicable consent laws
- [ ] **STARTUP-VOICE-04**: Voice failure-mode handling — if `execute('register_startup', ...)` fails (e.g., email already registered), AI agent gracefully recovers ("looks like you're already in our system — i'll text you a fresh install link") + alerts Ridhi via internal Slack/email

**Weekly text touchbase:**

- [ ] **STARTUP-TOUCHBASE-01**: CF Worker scheduled trigger (Monday 9am ET, per-startup-configurable) — pulls fresh candidates for each opted-in startup; SMS via Telnyx: `"hey [founder] — 3 new candidates this week for [role]. reply 1/2/3 to see, or 'stop' to opt out."`
- [ ] **STARTUP-TOUCHBASE-02**: Touchbase reply parser — "1"/"2"/"3" → `execute('show_candidate', {position})` → SMS sends candidate snapshot; "stop" → opt-out; arbitrary text → routes through SMS intent classifier as normal request

**Multi-channel proof + pilot:**

- [ ] **STARTUP-MULTICHAN-01**: `apps/startup-mcp/CHANNELS.md` updated with the Telnyx adapter as the concrete proof-of-concept for the channel-adapter pattern established in Phase 28. Includes adapter code-sketch for Slack/Discord/Teams (v1.5).
- [ ] **STARTUP-MULTICHAN-02**: First pilot startup end-to-end via Telnyx: founder calls number → voice intake → activated → receives SMS install link → opts into weekly touchbase → following Monday receives 3-candidate SMS → replies "1" → receives candidate snapshot. Evidence in `.planning/milestones/v1.4-pilot-readiness/phases/29-startup-telnyx-voice-sms/PILOT-EVIDENCE.md`.

### Group E — Test floor

- [ ] **WSTEST-01**: Vitest harness added to `apps/parrot/workers/`; smoke test for `/healthz` returning expected JSON shape with all readiness keys. *Team: team-workspace*
- [ ] **WSTEST-02**: One happy-path smoke test per Worker route file in `apps/parrot/workers/routes/` (return 200 with expected shape). *Team: team-workspace*
- [ ] **WSTEST-03**: `npm test` in `apps/parrot/` documented in README; ideally wired to GitHub Actions on `rrr/v1.4/team-workspace` branch. *Team: team-workspace*

### Group F — Marketing Brand Refresh (team-cms)

Apply the v1.0 brand system (lavender anchor + ink text + lime/tangerine/cobalt accents + Inter type stack + lowercase-text voice) to `apps/marketing/`. Spec captured at `.planning/brand/BRAND-V1.md` (source: `~/Downloads/internjobs_brand_guidelines_1.pdf` + `~/Downloads/logo_pack/`). Folded into Phase 22 since team-cms has bandwidth (Phase 22 was Lakera-only).

**Foundation — CSS tokens + typography:**

- [ ] **BRAND-TOKENS-01**: 6 brand color CSS variables (`--lavender #E8DEF5`, `--ink #1A0D2E`, `--lime #CAFF4D`, `--tangerine #FF7A3A`, `--cobalt #3855FF`, `--cream #FAF6EB`) defined in `apps/marketing/src/styles.css` (or `tailwind.config.ts`). **No hex literals in components.**
- [ ] **BRAND-TOKENS-02**: Radii tokens added — `--radius-card: 18px`, `--radius-pill: 999px`, `--radius-mark: 8px`
- [ ] **BRAND-TYPE-01**: Inter font loaded with all weights 400, 500, 600, 700, 800, 900 (Google Fonts or self-hosted). **No fallback substitution in headline elements.**
- [ ] **BRAND-TYPE-02**: Type-scale tokens for Display / H1 / H2 / H3 / Body / Label match spec exactly (Inter 900/72-96px/-0.04em, Inter 800/36-48px/-0.025em, etc — see `.planning/brand/BRAND-V1.md §2`)

**Layout system — one-accent-per-section:**

- [ ] **BRAND-LAYOUT-01**: Apex `/` landing page restructured as lavender background + ink text + lime accent (hero default per section playbook)
- [ ] **BRAND-LAYOUT-02**: `/startups` (for-companies) page uses cobalt accent for hero + CTA; logo switches to `lockup-lavender.svg` per cobalt exception
- [ ] **BRAND-LAYOUT-03**: Page-level `data-accent="lime|tangerine|cobalt"` attribute drives the section's accent; punctuation-accent + CTA-pill components inherit, don't override
- [ ] **BRAND-LAYOUT-04**: Cream `#FAF6EB` allowed only on `/privacy` + `/terms` long-form pages; cream + lavender never mixed on the same surface
- [ ] **BRAND-LAYOUT-05**: Grep-audit `apps/marketing/` for `#fff`, `#FFFFFF`, `white`, `#000`, gray-fill — all removed in favor of token variables (per "no white, no pure black, no gray fills" rule)

**Logo asset migration:**

- [ ] **BRAND-LOGO-01**: 7 SVG logo variants copied from `~/Downloads/logo_pack/*.svg` into `apps/marketing/public/logo/`
- [ ] **BRAND-LOGO-02**: 28 PNG variants copied from `~/Downloads/logo_pack/png/` into `apps/marketing/public/logo/png/` for favicon/OG/social use
- [ ] **BRAND-LOGO-03**: Site header (lavender bg) uses `lockup-gradient-ink.svg` per "approved combinations · primary on lavender"
- [ ] **BRAND-LOGO-04**: Cobalt sections (e.g., `/startups` hero) use `lockup-lavender.svg` per cobalt exception
- [ ] **BRAND-LOGO-05**: Favicon updated using `mark-gradient_256w.png` (multi-size: 16/32/64); Apple touch icon (180px) + safari-pinned-tab SVG added
- [ ] **BRAND-LOGO-06**: OG image (1200×630) for social sharing generated from logo + tagline ("internships, in your dms.") on lavender bg; meta tags wired in `apps/marketing/index.html`
- [ ] **BRAND-LOGO-07**: Logo respects clearspace (1× mark height) and minimum sizes (28px mark, 120px lockup) — verified in QA

**Copy — voice rewrites:**

- [ ] **BRAND-COPY-01**: Apex hero rewritten as "internships**,** in your dms**.**" — lowercase headline, comma + dot in lime accent (inline spans, not images)
- [ ] **BRAND-COPY-02**: Apex hero subhead = three-bullet pattern "no resumes · no cover letters · just texts" with middle dots
- [ ] **BRAND-COPY-03**: Apex primary CTA = "get on the list →" (lowercase, arrow, lime pill on lavender)
- [ ] **BRAND-COPY-04**: `/startups` hero rewritten as "hire interns by text**,** not by tower of resumes**.**" — lowercase, accent in cobalt
- [ ] **BRAND-COPY-05**: `/startups` CTA = "post a role →" (cobalt pill, lavender text, lowercase)
- [ ] **BRAND-COPY-06**: Uppercase labels (e.g., "JOIN EARLY ACCESS · HOUSTON, TX") use Inter 600, tracking 0.1em, per Label/Caps spec
- [ ] **BRAND-COPY-07**: Brand-name audit — every reference uses `internjobs.ai` lowercase (including the dot); headlines all lowercase
- [ ] **BRAND-COPY-08**: Grep-audit for forbidden corporate-speak ("Unlock", "Streamline", "revolutionary", "in today's competitive landscape", title-case headlines) — removed in favor of brand-voice phrasings

**Verification:**

- [ ] **BRAND-VERIFY-01**: WCAG contrast check — ink on lavender clears AAA for body; lime backgrounds use ink text; cobalt + ink-dark backgrounds use lavender text (never gray/white). Tested with axe-core or equivalent.
- [ ] **BRAND-VERIFY-02**: Visual QA on production deploy — every section has exactly one accent; no two accents next to each other; no white background regressed in
- [ ] **BRAND-VERIFY-03**: Punctuation accents implemented as inline spans (`<span class="accent-dot">.</span>`), not background images; verified by view-source spot-check

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

Each Active v1.4 requirement maps to exactly one phase. Populated by `/rrr:create-roadmap` 2026-05-24.

| Requirement | Phase | Team | Status |
|-------------|-------|------|--------|
| LAKERA-V2-01..03 | Phase 22 | team-cms | Pending |
| SAFETY-VERIFY-LIVE-01..03 | Phase 22 | team-cms | Pending |
| CLOSETODO-01..04 | Phase 23 | team-workspace | Pending |
| SAFETY-VERIFY-LIVE-04 | Phase 23 | team-workspace | Pending |
| ATTACH-DOWN-01..03 | Phase 23 | team-workspace | Pending |
| AGENT-UAT-01..03 | Phase 23 | team-workspace | Pending |
| NEONEX-VER-01..04 | Phase 24 | team-cms | Complete |
| NEONEX-DOC-01..03 | Phase 24 | team-cms | Complete |
| MMSSO-01..03 | Phase 25 | team-workspace | Pending |
| ADMIN-UX-01..04 | Phase 25 | team-workspace | Pending |
| NEONEX-DEP-01 | Phase 25 | team-workspace | Pending |
| KGRAPH-01..05 | Phase 26 | team-workspace | Pending |
| GENZ-01..03 | Phase 26 | team-workspace | Pending |
| DAILY-THEME-01 | Phase 27 | team-workspace | Pending |
| STAR-API-01 | Phase 27 | team-workspace | Pending |
| DATES-01 | Phase 27 | team-workspace | Pending |
| WSTEST-01..03 | Phase 27 | team-workspace | Pending |
| BRAND-TOKENS-01..02 | Phase 22 | team-cms | Pending |
| BRAND-TYPE-01..02 | Phase 22 | team-cms | Pending |
| BRAND-LAYOUT-01..05 | Phase 22 | team-cms | Pending |
| BRAND-LOGO-01..07 | Phase 22 | team-cms | Pending |
| BRAND-COPY-01..08 | Phase 22 | team-cms | Pending |
| BRAND-VERIFY-01..03 | Phase 22 | team-cms | Pending |
| STARTUP-MCP-01..10 | Phase 28 | team-cms | Complete |
| STARTUP-ADMIN-01..02 | Phase 28 | team-cms | Complete |
| STARTUP-CHANNEL-01..02 | Phase 28 | team-cms | Complete |
| STARTUP-MARKETING-01..02 | Phase 28 | team-cms | Complete |
| STARTUP-PILOT-01 | Phase 28 | team-cms | Deferred → v1.5 STARTUP-PILOT-LIVE-01 |
| STARTUP-WEB-AUTH-01..04 | Phase 28.5 | team-cms | Code-complete (ops deferred) |
| STARTUP-WEB-DASH-01..03 | Phase 28.5 | team-cms | Code-complete (ops deferred) |
| STARTUP-AGENT-EMAIL-01..04 | Phase 28.5 | team-cms | Code-complete (ops deferred) |
| STARTUP-WEB-CTA-01 | Phase 28.5 | team-cms | Complete |
| STARTUP-WORK-EMAIL-01 | Phase 28.5 | team-cms | Code-complete (ops deferred) |
| STARTUP-TELNYX-01..06 | Phase 29 | team-cms | Code-complete (ops deferred) |
| STARTUP-VOICE-01..04 | Phase 29 | team-cms | Code-complete (ops deferred) |
| STARTUP-TOUCHBASE-01..02 | Phase 29 | team-cms | Code-complete (ops deferred) |
| STARTUP-MULTICHAN-01..02 | Phase 29 | team-cms | Code-complete (ops deferred — pilot E2E deferred to v1.5 STARTUP-PILOT-LIVE-02) |

**Coverage (v1.4):**
- Active requirements: 109 total (46 original + 22 brand + 14 Startup MCP + 13 Startup Web/Email + 14 Startup Telnyx)
- Mapped to phases: 109 ✓
- Unmapped: 0 ✓

**Phase distribution:**
- Phase 22 (team-cms): **28 reqs** — LAKERA-V2 (3) + SAFETY-VERIFY-LIVE-01..03 (3) + BRAND (22)
- Phase 23 (team-workspace): 11 reqs — CLOSETODO + SAFETY-VERIFY-LIVE-04 + ATTACH-DOWN + AGENT-UAT
- Phase 24 (team-cms): 7 reqs — NEONEX-VER + NEONEX-DOC
- Phase 25 (team-workspace): 8 reqs — MMSSO + ADMIN-UX + NEONEX-DEP
- Phase 26 (team-workspace): 8 reqs — KGRAPH + GENZ
- Phase 27 (team-workspace): 6 reqs — DAILY-THEME + STAR-API + DATES + WSTEST
- **Phase 28 (team-cms): 14 reqs — STARTUP-MCP-01..10 + STARTUP-ADMIN-01..02 + STARTUP-CHANNEL-01..02 + STARTUP-MARKETING-01..02 + STARTUP-PILOT-01** *(13 distinct items grouped + 1 added MARKETING-02)*
- **Phase 28.5 (team-cms): 13 reqs — STARTUP-WEB-AUTH-01..04 + STARTUP-WEB-DASH-01..03 + STARTUP-AGENT-EMAIL-01..04 + STARTUP-WEB-CTA-01 + STARTUP-WORK-EMAIL-01**
- **Phase 29 (team-cms): 14 reqs — STARTUP-TELNYX-01..06 + STARTUP-VOICE-01..04 + STARTUP-TOUCHBASE-01..02 + STARTUP-MULTICHAN-01..02**

**Team load:**
- team-cms: 76 requirements across Phases 22 + 24 + 28 + 28.5 + 29
- team-workspace: 33 requirements across Phases 23 + 25 + 26 + 27

**Cross-team sequencing:**
- Phase 23 (team-workspace) depends on Phase 22 (team-cms) — SAFETY-VERIFY-LIVE-04 needs Lakera v2 schema from LAKERA-V2-02
- Phase 29 (team-cms) depends on Phase 28 (team-cms) — Telnyx adapter calls the MCP core from Phase 28
- Otherwise teams run in parallel on their own branches

---
*Requirements defined: 2026-05-19 (v1.3)*
*Last updated: 2026-05-24 — v1.4 milestone defined. v1.3 moved to Validated with carryover refs (SAFETY-LAKERA-01 → LAKERA-V2-*, SAFETY-VERIFY-01..03 → SAFETY-VERIFY-LIVE-*, AUTO-CLEAR-VERIFY-02 → CLOSETODO-03). Neon-exit + agent-lift un-roadmapped items added to Validated. v1.4 Active = 39 requirements across Groups A (5 closeouts), B (3 Neon-exit closeout), C (4 carryovers + Workspace upgrades), D (3 polish), E (1 test floor) — pre-assigned to team-cms / team-workspace. SEC-ROTATE deferred to v1.5 Candidates. First milestone under RRR team mode.*
