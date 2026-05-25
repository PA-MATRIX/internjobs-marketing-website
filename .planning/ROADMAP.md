# Roadmap: InternJobs.ai

## Milestones

- ✅ **v1.0 Waitlist Identity and Messaging Foundation** — Phases 01–06 (shipped 2026-05-09)
- ✅ **v1.1 Seamless Waitlist and Student Threading** — Phase 07 (shipped 2026-05-15)
- ✅ **v1.2 Two-Sided Agent MVP** — Phases 08–17 (shipped 2026-05-19)
- ✅ **v1.3 Pilot Hardening** — Phases 18–20 shipped; Phase 21 skipped (sole-user deferral). Plus un-roadmapped Neon-exit shipped 2026-05-21.
- 🚧 **v1.4 Pilot Readiness** — Phases 22–27 (first team-mode milestone: `team-cms` + `team-workspace`)

## Overview

v1.4 closes v1.3's dangling work (closeTodoFact writer, Lakera live verification, attachment download, agent-lift UAT), the un-roadmapped initiatives that landed after v1.3 ship-ready (Neon-exit verification + doc refresh), the Workspace upgrades from the v1.3 backlog memo (Mattermost SSO, knowledge-graph reuse, admin invite UX, GenZ chat polish), and a Worker-side test floor. **Then it opens the startup pilot channel:** Phase 28 builds the MCP server foundation (reaches every founder using Claude/Cursor/ChatGPT — all MCP-native by 2026); Phase 29 adds Telnyx SMS + Voice AI with voice-based onboarding for non-tech founders + a weekly text touchbase. Ridhi handles white-glove concierge onboarding for the first 5–10 pilots in parallel. Slack/Discord/Teams adapters are deferred to v1.5 (Slack marketplace timeline is real, and Claude/ChatGPT MCP bridges Slack already). Email-initiated channels also v1.5. The milestone is split across two GitHub teams: `team-cms` (Marketing CMS + Student app + Startup MCP/Telnyx) and `team-workspace` (Workspace + Mattermost + graph-api). Phase order serializes cross-team dependencies (Phase 23 needs Phase 22's Lakera schema verification; Phase 29 builds on Phase 28); otherwise teams run in parallel on their own branches.

## Phases

**Phase Numbering:**
- Integer phases (22-27): Planned v1.4 work
- Decimal phases (e.g., 22.1): Reserved for urgent insertions during execution

- [ ] **Phase 22: Lakera Verification + Marketing Brand Refresh** — *team-cms*. Verify Lakera (Cisco AI Defense) v2 schema in production + run 3 student-SMS-path safety tests live + apply v1.0 brand system to `apps/marketing/` (lavender anchor + ink + lime/tangerine/cobalt accents + Inter type + new logo pack + voice rewrites)
- [ ] **Phase 23: Workspace Pilot Closeouts** — *team-workspace*. closeTodoFact writer + Workspace email Lakera test + attachment download + agent-lift authenticated UAT
- [ ] **Phase 24: Neon-Exit Closeout** — *team-cms*. End-to-end verification of new student-app `/internal/safety-events` API + planning doc refresh
- [ ] **Phase 25: SSO Activation + Admin UX** — *team-workspace*. Mattermost OIDC SSO activation + frontend admin page with capability toggles + orphan Neon dep cleanup
- [ ] **Phase 26: Knowledge Graph + GenZ Polish** — *team-workspace*. FalkorDB `:Employee` namespace reuse for Workspace agent + Mattermost GIF picker + canvas-confetti micro-animations
- [ ] **Phase 27: Polish + Test Floor** — *team-workspace*. Daily.co theme retry + star-toggle API + `formatQuotedDate` cleanup + Vitest smoke tests for Workspace Worker routes
- [ ] **Phase 28: Startup MCP Server + Channel-Adapter Core** — *team-cms*. New `apps/startup-mcp/` Cloudflare Worker exposing a Stainless-style `search` + `execute` + `me` + `discover_actions` MCP tool surface at `mcp.internjobs.ai`; reaches every founder using Claude Desktop / Code / Cursor / Cline / ChatGPT (all MCP-native by 2026). Ridhi handles concierge onboarding for first 5–10 pilots via a small admin endpoint (`/admin/startups/new` issues per-startup MCP install token). Channel-adapter pattern + `startup_channel_links` schema future-proofs Phase 29 (Telnyx) and v1.5 (Slack/Discord/Teams).
- [ ] **Phase 29: Startup Telnyx SMS + Voice AI + Voice-Based Onboarding** — *team-cms*. Toll-free Telnyx number (skips A2P 10DLC wait); SMS inbound webhook → intent classifier → MCP `execute()`; Telnyx Voice AI Agent configured to call our MCP tools directly; voice-intake onboarding flow ("call, get onboarded in 30 seconds"); weekly text touchbase scheduled task for non-Slack/non-MCP founders. The killer "feel heard, no work" channel for non-tech startup founders.

## Phase Details

### Phase 22: Lakera Verification + Marketing Brand Refresh

**Goal**: Two-track team-cms phase. Track 1: make Lakera Guard pre-LLM safety screening actually functional end-to-end on the student SMS path (v1.3 shipped the code; v1.4 verifies it works in production against the post-Cisco-acquisition API). Track 2: apply the v1.0 brand system to `apps/marketing/` (lavender anchor + ink text + lime/tangerine/cobalt one-per-section accents + Inter type stack + new logo pack + voice rewrites). Tracks are independent and can run in parallel within team-cms.

**Team owner**: `team-cms`
**Branch**: `rrr/v1.4/team-cms`
**Depends on**: Nothing (first phase of v1.4)

**Requirements**: LAKERA-V2-01..03, SAFETY-VERIFY-LIVE-01..03, BRAND-TOKENS-01..02, BRAND-TYPE-01..02, BRAND-LAYOUT-01..05, BRAND-LOGO-01..07, BRAND-COPY-01..08, BRAND-VERIFY-01..03 *(28 total)*

**Brand spec source**: `.planning/brand/BRAND-V1.md` (captured from the PDF + logo pack on 2026-05-24)

**Success Criteria** (what must be TRUE):

*Lakera (Track 1):*
1. Live injection-test student SMS is hard-blocked, student receives the exact canned reply, `safety_events` row written with `action='blocked'`
2. Live benign student SMS produces zero `safety_events` log entries and the agent replies normally
3. Simulated Lakera 5xx produces a `passed_lakera_unavailable` row and the message proceeds (fail-open verified)
4. Lakera (Cisco AI Defense) v2 endpoint + response schema verified at `platform.lakera.ai`; parser blocks in `screen.mjs` + `safety.ts` match production reality
5. Pricing tier confirmed sufficient for 30k/month pilot volume

*Brand (Track 2):*
6. `apps/marketing/` builds with all brand tokens as CSS variables; **zero hex literals in components, zero white/pure-black/gray-fill**
7. Inter loaded with all weights 400–900; no fallback substitution in headlines
8. Apex `/` uses lavender + ink + lime hero; `/startups` uses lavender + ink + cobalt hero with `lockup-lavender.svg` (cobalt exception)
9. New logo pack live: gradient lockup in header, mark-gradient favicon (multi-size), OG image (1200×630) on lavender
10. Brand-voice rewrites live — apex hero "internships, in your dms." + /startups hero "hire interns by text, not by tower of resumes." (lowercase, punctuation accents in section accent color, three-bullet supporting line)
11. WCAG AAA contrast for body, AA for display; one accent per section; corporate-speak audit grep returns zero matches

**Plans**: 5 plans

Plans:
- [ ] 22-01: Lakera v2 schema verification + parser-block updates if needed (LAKERA-V2-01..03)
- [ ] 22-02: 3 production-path SAFETY-VERIFY-LIVE tests against student SMS (SAFETY-VERIFY-LIVE-01..03)
- [ ] 22-03: Brand foundation — CSS tokens + Inter loaded + logo SVG/PNG assets committed (BRAND-TOKENS-01..02, BRAND-TYPE-01..02, BRAND-LOGO-01..05)
- [ ] 22-04: Brand surface — apex + /startups layout / accent system / copy rewrites + favicon + OG image (BRAND-LAYOUT-01..05, BRAND-LOGO-06..07, BRAND-COPY-01..08)
- [ ] 22-05: Brand verify — contrast checks + visual QA + corporate-speak audit + punctuation-accent inline-span spot-check (BRAND-VERIFY-01..03)

**Research flags**: Unlikely on both tracks (Lakera docs available + reuses existing helpers; brand spec captured at `.planning/brand/BRAND-V1.md`, logo pack at `~/Downloads/logo_pack/`)

---

### Phase 23: Workspace Pilot Closeouts

**Goal**: Close the v1.3-shipped-but-incomplete Workspace items so Workspace is functionally pilot-ready. Includes the missing `closeTodoFact` writer (without which Phase 19's auto-clear cron is inert), the Workspace-side Lakera test, the attachment download endpoint, and the agent-lift UAT.

**Team owner**: `team-workspace`
**Branch**: `rrr/v1.4/team-workspace`
**Depends on**: Phase 22 (SAFETY-VERIFY-LIVE-04 needs the v2 Lakera schema verified first)

**Requirements**: CLOSETODO-01, CLOSETODO-02, CLOSETODO-03, CLOSETODO-04, SAFETY-VERIFY-LIVE-04, ATTACH-DOWN-01, ATTACH-DOWN-02, ATTACH-DOWN-03, AGENT-UAT-01, AGENT-UAT-02, AGENT-UAT-03

**Success Criteria** (what must be TRUE):
1. Agent reply containing resolution-acknowledgement phrase writes `:Todo.valid_to` in FalkorDB; next auto-clear tick closes the linked SQLite todo within 30s; todo appears in Resolved view
2. Injection email from a non-startup_members sender is silently hard-blocked; `safety_events` row written with no auto-reply
3. Clicking an attachment in Workspace inbox downloads the file in Chrome + Safari (no 404)
4. AgentPanel quick actions (summarize, draft, translate) return live LLM results in production within 10s
5. MCPPanel lists all 11 MCP tools and tool calls return non-error responses

**Plans**: TBD (likely 4)

Plans:
- [ ] 23-01: `closeTodoFact` Cypher helper + Workspace reply-path integration + structured logging (CLOSETODO-01..04)
- [ ] 23-02: SAFETY-VERIFY-LIVE-04 — Workspace email injection test
- [ ] 23-03: Attachment download route + auth + EmailPanel wire-up (ATTACH-DOWN-01..03)
- [ ] 23-04: 14-step authenticated UAT for agent-lift features (AGENT-UAT-01..03)

**Research flags**: Unlikely (all reuses existing infrastructure)

---

### Phase 24: Neon-Exit Closeout

**Goal**: Verify the Neon-exit migration (shipped 2026-05-21 un-roadmapped) is correct end-to-end through the new student-app `/internal/safety-events` API, then refresh planning docs that still describe the old Neon topology.

**Team owner**: `team-cms` (owns student-app API + coordinator role for docs)
**Branch**: `rrr/v1.4/team-cms`
**Depends on**: Nothing — code is already shipped, this verifies + documents

**Requirements**: NEONEX-VER-01, NEONEX-VER-02, NEONEX-VER-03, NEONEX-VER-04, NEONEX-DOC-01, NEONEX-DOC-02, NEONEX-DOC-03

**Success Criteria** (what must be TRUE):
1. Live Lakera-blocked inbound triggers successful POST from Workspace Worker to student-app `/internal/safety-events` with valid Bearer auth
2. `/ops/safety` in Workspace renders the resulting row by reading through the new API
3. Bearer secret mismatch returns 401; student app logs the failed attempt without crashing
4. Unreviewed-count badge in Workspace updates correctly via `/internal/safety-events/unreviewed-count`
5. `HANDOFF.md §4`, `ROADMAP.md`, and `infisical-project` memory all reflect the post-migration topology

**Plans**: TBD (likely 2)

Plans:
- [ ] 24-01: End-to-end safety_events API verification + negative tests (NEONEX-VER-01..04)
- [ ] 24-02: Docs refresh — HANDOFF.md, ROADMAP.md note, infisical-project memory (NEONEX-DOC-01..03)

**Research flags**: Unlikely (verification work; no new tech)

---

### Phase 25: SSO Activation + Admin UX

**Goal**: Activate Mattermost OIDC SSO so chat is single-sign-on for employees (code already shipped in v1.2; this is the mmctl config step), and complete the admin invite UX so Ridhi can invite + manage employee capabilities through the frontend (not just the API). Folds in the orphan `@neondatabase/serverless` dep cleanup from Neon-exit since team-workspace is the only team that touches `apps/parrot/package.json`.

**Team owner**: `team-workspace`
**Branch**: `rrr/v1.4/team-workspace`
**Depends on**: Phase 23 (sequential on team-workspace branch)

**Requirements**: MMSSO-01, MMSSO-02, MMSSO-03, ADMIN-UX-01, ADMIN-UX-02, ADMIN-UX-03, ADMIN-UX-04, NEONEX-DEP-01

**Success Criteria** (what must be TRUE):
1. User signing into `chat.internjobs.ai` clicks "GitLab" button → bounces through Workspace OIDC → lands signed in to Mattermost in <5s
2. New employee (invited via admin UX) auto-provisions a Mattermost user on first OIDC sign-in
3. Ridhi can open `/admin`, see employees with capability toggles (email/chat/meetings/phone/sms/campaigns), and edit them post-invite
4. Invite form creates Clerk phone-OTP user + CF Email Routing rule + WorkspaceDO row + sends personalized welcome email from Ridhi
5. `@neondatabase/serverless` removed from `apps/parrot/package.json`; `npm run build` still passes

**Plans**: TBD (likely 3)

Plans:
- [ ] 25-01: Mattermost SSO mmctl activation + first-login Mattermost user auto-provisioning (MMSSO-01..03)
- [ ] 25-02: `/admin` frontend page + capability-toggle UI + invite form (ADMIN-UX-01..04)
- [ ] 25-03: Drop orphan `@neondatabase/serverless` from Workspace package.json (NEONEX-DEP-01)

**Research flags**: Unlikely (Mattermost OIDC docs known; admin backend exists)

---

### Phase 26: Knowledge Graph + GenZ Polish

**Goal**: Lift Workspace agent extraction quality by reusing the existing FalkorDB instance for cross-conversation `:Employee` context (mirroring the student app's `getStudentSummary` pattern — unblocked by v1.3 Phase 18 making the graph reachable from Workspace). Add GenZ-friendly chat polish (Mattermost GIF picker + canvas-confetti) for the HS/college-intern audience.

**Team owner**: `team-workspace`
**Branch**: `rrr/v1.4/team-workspace`
**Depends on**: Phase 25 (sequential on team-workspace branch)

**Requirements**: KGRAPH-01, KGRAPH-02, KGRAPH-03, KGRAPH-04, KGRAPH-05, GENZ-01, GENZ-02, GENZ-03

**Success Criteria** (what must be TRUE):
1. Workspace agent extraction reads `getEmployeeContext` from the `:Employee` namespace and prepends it to the kimi extraction prompt
2. Post-extraction fire-and-forget writes new `:Todo` + `:MENTIONS` + `:BLOCKED_BY` edges into the `:Employee` namespace
3. Cross-namespace isolation verified — `:Employee` queries return zero `:Student` nodes and vice versa
4. Qualitative A/B comparison on 10 real extractions shows reduced duplicate-todo rate
5. Mattermost GIF/sticker plugin live and reachable from chat composer; first-todo-cleared + 5-emails-responded confetti animations fire; parrot-mascot loading state replaces generic spinner

**Plans**: TBD (likely 2)

Plans:
- [ ] 26-01: `getEmployeeContext` + write-back + cross-namespace isolation + A/B comparison (KGRAPH-01..05)
- [ ] 26-02: Mattermost GIF plugin + canvas-confetti + parrot-mascot loading (GENZ-01..03)

**Research flags**: Likely (KGRAPH-01..03 — verify FalkorDB Cypher patterns for namespace isolation; reuse student app's `getStudentSummary` as template)

---

### Phase 27: Polish + Test Floor

**Goal**: Land the small UX/quality items deferred from v1.3 (Daily.co theme retry, star-toggle API) and establish a Vitest smoke-test baseline for Workspace Worker so future regressions are caught at PR time. Includes the cross-app `formatQuotedDate` cleanup that touches both `apps/agentic-inbox/` and `apps/parrot/` (both team-workspace-owned).

**Team owner**: `team-workspace`
**Branch**: `rrr/v1.4/team-workspace`
**Depends on**: Phase 26 (sequential on team-workspace branch)

**Requirements**: DAILY-THEME-01, STAR-API-01, DATES-01, WSTEST-01, WSTEST-02, WSTEST-03

**Success Criteria** (what must be TRUE):
1. Daily.co Prebuilt themed with Campus Aurora palette (accent `#7C3AED`, bg `#FAFAFA`); verified in `/meetings` iframe
2. Star toggle in EmailPanel persists state via `PATCH /api/inbox/messages/:id`; UI reflects the change
3. `formatQuotedDate` callers in `apps/agentic-inbox/` + `apps/parrot/` use `packages/shared/src/dates`; 3 `@deprecated` re-exports deleted
4. `npm test` in `apps/parrot/` runs Vitest smoke tests covering `/healthz` and each route file; all pass
5. `apps/parrot/README.md` documents how to run tests locally; ideally wired into a GitHub Action on the team branch

**Plans**: TBD (likely 2)

Plans:
- [ ] 27-01: Daily.co theme + star API + dates cleanup (DAILY-THEME-01, STAR-API-01, DATES-01)
- [ ] 27-02: Vitest harness + route smoke tests + README + optional CI wiring (WSTEST-01..03)

**Research flags**: Unlikely (all reuses known patterns)

---

### Phase 28: Startup MCP Server + Channel-Adapter Core

**Goal**: First scalable channel for startup-initiated interaction with internjobs.ai. New Cloudflare Worker MCP server at `mcp.internjobs.ai` lets a startup founder (operating via Claude Desktop / Claude Code / Cursor / Cline / ChatGPT — all MCP-native by 2026) post roles, search candidates, and reply to threads — without touching a dashboard. Ridhi handles white-glove concierge onboarding for the first 5–10 pilots via a small admin endpoint; self-serve install lands later. Architecture is channel-adapter from day one so Phase 29 (Telnyx SMS/Voice) and v1.5 (Slack/Discord/Teams) plug in as ~50–100 LOC adapters on the same core.

**Team owner**: `team-cms`
**Branch**: `rrr/v1.4/team-cms`
**Depends on**: Nothing (parallel to Phase 24)

**Requirements**: STARTUP-MCP-01..10 + STARTUP-ADMIN-01..02 + STARTUP-CHANNEL-01..02 + STARTUP-MARKETING-01 + STARTUP-PILOT-01 *(~13 total)*

**Architecture (Stainless-style search + execute pattern):**

Four MCP tools total — does not grow as action surface grows:

| Tool | Purpose | Rationale |
|---|---|---|
| `me()` | Constant-time identity lookup: current startup + member + role count + recent activity | Frequent, cheap; better as its own tool than via `search` |
| `discover_actions()` | List available action names + JSON schemas + descriptions | LLM grounding — mirrors Stainless's `list_api_endpoints`. Lets the LLM learn the action surface without bloating the tool list. |
| `search(scope, query, filters?)` | Universal read across `roles`, `candidates`, `threads`, `messages`, `members`, `startups`; semantic (pgvector) + structured filter | One tool scales to any new readable entity |
| `execute(action, params)` | Universal write. `action` is an ENUM (not free-form string) → per-action authz + per-action audit log row preserved. Per-action handler with schema validation. | Avoids the "omnibus execute" security pitfall (free-form `run` collapses audit trail) while keeping the catalog at 4 tools |

Action enum (v1, 5 actions): `post_role`, `reply_to_candidate`, `update_role`, `archive_role`, `mark_candidate`. Action enum is the unit of authorization, audit, and rate-limit — not the `execute` tool itself.

**Concierge onboarding pattern (pilot-scale):**

Ridhi runs intake via call/text/email with each pilot founder. She then calls an admin endpoint `POST /admin/startups/new({company, founder_email, founder_phone})` that:
1. Inserts a `startups` row + `startup_members` row (founder role)
2. Generates a per-startup MCP install token
3. SMS-sends the install snippet directly to the founder: `claude mcp add internjobs https://mcp.internjobs.ai/{token}`

Founder pastes into their Claude/Cursor/ChatGPT, MCP server activates, they call `me()` → they're in. Self-serve `/onboarding/start` endpoint (email magic-link or signup form) is deferred to v1.5.

**Channel-adapter architecture (multi-transport-ready):**

Every channel resolves identity to a `(startup_id, member_id)` pair via a new `startup_channel_links` table, then routes through the same core. The MCP server is the first transport; the table schema and core router are written so Phase 29 (Telnyx) + v1.5 channels (Slack/Discord/Teams) each become thin adapters. Telnyx Voice AI in particular is configurable to call our MCP server tools directly — zero custom voice code in Phase 29.

Documented in `apps/startup-mcp/CHANNELS.md` as part of this phase. Future channels are NOT scoped here, but the architecture must support them as drop-ins.

**Channel scope (locked in this phase):**

- Students: iMessage (BlueBubbles) + SMS (Spectrum/Photon) — unchanged
- **Startups: MCP first (Phase 28) → Telnyx SMS/Voice AI (Phase 29) → Slack/Discord/Teams (v1.5) → email-initiated (v1.5). NO iMessage for startups.**
- Employees: Workspace UI + Mattermost — unchanged

**Success Criteria** (what must be TRUE):

1. Ridhi calls the admin endpoint with a founder's details; founder receives an SMS with the MCP install command; founder pastes into Claude Desktop / Cursor / ChatGPT and `me()` returns their startup identity
2. The same founder calls `execute('post_role', {role_spec})` and a new row appears in `roles` table; subsequent `search('candidates', 'frontend interns')` returns ranked candidates via pgvector
3. The founder calls `execute('reply_to_candidate', {thread_id, message})` and the message appears in the existing conversation thread (same `inbound_messages` / `outbound_messages` schema as the email path — no fragmentation)
4. `discover_actions()` returns all 5 action schemas; LLM uses it to learn the surface without preloading
5. Per-action audit log row written in `startup_action_log` for every `execute()` call (member_id, channel='mcp', action, params_hash, status, latency_ms)
6. Per-action authorization enforced: a member cannot post/archive roles for a startup they don't belong to; a member cannot reply to threads outside their startup's scope (negative tests)
7. `apps/startup-mcp/CHANNELS.md` documents the path from MCP-only to Telnyx SMS/Voice (Phase 29) and to Slack/Discord/Teams (v1.5) as transport adapters on the same core — proves multi-channel-ready
8. The `/startups` marketing page has a "Request access — we'll text you the install" CTA that emails Ridhi the founder's details

**Plans**: TBD (likely 3)

Plans:
- [ ] 28-01: MCP server scaffold + auth + 4-tool surface (`me`, `discover_actions`, `search`, `execute`) + `startup_channel_links` + `startup_action_log` schema + 5 action handlers (STARTUP-MCP-01..10 + STARTUP-CHANNEL-01)
- [ ] 28-02: Admin onboarding endpoint + per-startup token issuance + SMS install-snippet sender (STARTUP-ADMIN-01..02)
- [ ] 28-03: Marketing CTA on `/startups` + channels-grid "how we work with you" section (Claude/ChatGPT/Voice/SMS/Email primary; Slack/Discord/Teams "coming soon") + `CHANNELS.md` architecture doc + first pilot install end-to-end + evidence committed (STARTUP-MARKETING-01..02 + STARTUP-CHANNEL-02 + STARTUP-PILOT-01)

**Research flags**: Unlikely (Stainless pattern documented; existing v1.2 schema already has `startups`, `startup_members`, `roles`; existing student-app `/internal/*` API surface from Neon-exit is the write path)

---

### Phase 29: Startup Telnyx SMS + Voice AI + Voice-Based Onboarding

**Goal**: Catch the non-MCP / non-tech startup founder who'd rather talk than type. Provision a toll-free Telnyx number (skips A2P 10DLC wait), wire SMS inbound to the MCP `execute()` core, configure a Telnyx Voice AI Agent to call our MCP tools directly, and ship a **voice-intake onboarding flow** where a founder calls → AI greets and collects company/role/contact → activated in 30 seconds + receives SMS install link. Add a weekly text-touchbase scheduled task ("3 new candidates this week — reply 1/2/3"). This is the *"feel heard, no work"* channel.

**Team owner**: `team-cms`
**Branch**: `rrr/v1.4/team-cms`
**Depends on**: Phase 28 (Telnyx adapter calls the MCP core from Phase 28)

**Requirements**: STARTUP-TELNYX-01..06 + STARTUP-VOICE-01..04 + STARTUP-TOUCHBASE-01..02 + STARTUP-MULTICHAN-01..02 *(~14 total)*

**Architecture:**

| Component | What | Notes |
|---|---|---|
| Telnyx number | One toll-free for pilot | Avoids A2P 10DLC 4-week registration. Migrate to local-looking number when volume justifies (v1.5+). |
| SMS inbound | Telnyx webhook → CF Worker → intent classifier → MCP `execute()` | Existing `apps/startup-mcp/` Worker grows a new transport adapter; reuses `startup_channel_links` (channel_type='telnyx-sms', channel_external_id=phone) |
| SMS outbound | MCP responses + scheduled touchbase via Telnyx REST API | Same number both directions |
| Voice AI agent | Telnyx-hosted; configured to call our MCP server's tools via Telnyx's MCP integration | Zero custom voice code. Telnyx handles TTS, STT, intent, tool calling. We supply MCP endpoint + auth + action schemas. |
| Voice intake onboarding | Telnyx Voice AI script: greet → collect (company, founder name, work email, what they're hiring for) → call `execute('register_startup', ...)` → confirm via SMS install link | 30-second flow. Same identity-resolution path as Phase 28's admin endpoint. |
| Weekly touchbase cron | CF Worker scheduled trigger; pulls fresh candidates per startup → Telnyx SMS "3 new this week — reply 1/2/3" | Reply parsed by SMS webhook → `execute('show_candidate', {position})` → SMS the snapshot |

**Success Criteria** (what must be TRUE):

1. Toll-free Telnyx number provisioned + SMS + Voice AI enabled; phone in Infisical as `STARTUP_TELNYX_NUMBER`
2. A founder calls the number, Telnyx Voice AI completes the 4-question intake, and a row appears in `startups` + `startup_members` within 30 seconds of the call ending
3. The same founder receives an SMS with the MCP install snippet AND can opt into weekly touchbases (reply "yes" to confirm); confirmation persists in `startup_channel_links`
4. A founder texts the Telnyx number with a natural-language request ("show me the top 3 candidates for the frontend role") → intent classifier maps to `search('candidates', ...)` → SMS reply has 3 candidate snapshots
5. Weekly cron runs Monday 9am ET (configurable per startup); SMS sent to all opted-in startups with `last_touchbase_at < now - 7d` listing fresh candidate count + reply prompt
6. SMS reply with "1" → `execute('show_candidate', {position: 1})` → SMS sends candidate snapshot; reply with "stop" → opts out of touchbases; reply with arbitrary text → routes through intent classifier as a normal request
7. Telnyx Voice AI's call recordings + transcripts logged to a per-startup S3-equivalent (R2) for audit; opt-in disclosure in voice intake greeting
8. `apps/startup-mcp/CHANNELS.md` updated with the Telnyx adapter pattern as the concrete proof-of-concept for the channel-adapter architecture established in Phase 28

**Plans**: TBD (likely 3)

Plans:
- [ ] 29-01: Telnyx number provisioning + SMS inbound/outbound adapter wired into existing `apps/startup-mcp/` MCP core + identity resolution via `startup_channel_links` (STARTUP-TELNYX-01..06)
- [ ] 29-02: Telnyx Voice AI Agent configuration + voice-intake onboarding script + R2 audit log + opt-in disclosure (STARTUP-VOICE-01..04)
- [ ] 29-03: Weekly touchbase cron + reply intent parser + opt-in management + first pilot end-to-end test (call onboarding → SMS touchbase → reply round-trip) (STARTUP-TOUCHBASE-01..02 + STARTUP-MULTICHAN-01..02)

**Research flags**: Likely on STARTUP-VOICE-01..04 (Telnyx Voice AI is new product surface — verify current MCP-integration support, voice agent configuration UI, and SLA/cost characteristics at signup)

---

## Progress

**Execution Order (team-aware):**

- `team-cms`: Phase 22 → Phase 24 → Phase 28 → Phase 29 (sequential on `rrr/v1.4/team-cms`)
- `team-workspace`: Phase 23 → Phase 25 → Phase 26 → Phase 27 (sequential on `rrr/v1.4/team-workspace`)

**Cross-team dependencies:**
- Phase 23 (team-workspace) cannot start until Phase 22 (team-cms) is verified — SAFETY-VERIFY-LIVE-04 depends on LAKERA-V2-02 parser truth
- Phase 29 (team-cms) depends on Phase 28 (team-cms) — Telnyx adapter calls MCP core from Phase 28
- Otherwise teams run in parallel on their own branches

| Phase | Milestone | Owner | Plans Complete | Status | Completed |
|-------|-----------|-------|----------------|--------|-----------|
| 22. Lakera Verification + Marketing Brand Refresh | v1.4 | team-cms | 0/5 | In progress (4/5 plans ✓ shipped + brand patches) | — |
| 23. Workspace Pilot Closeouts | v1.4 | team-workspace | 0/TBD | Not started | — |
| 24. Neon-Exit Closeout | v1.4 | team-cms | 0/TBD | Not started | — |
| 25. SSO Activation + Admin UX | v1.4 | team-workspace | 0/TBD | Not started | — |
| 26. Knowledge Graph + GenZ Polish | v1.4 | team-workspace | 0/TBD | Not started | — |
| 27. Polish + Test Floor | v1.4 | team-workspace | 0/TBD | Not started | — |
| 28. Startup MCP Server + Channel-Adapter Core | v1.4 | team-cms | 0/TBD | Not started | — |
| 29. Startup Telnyx SMS + Voice AI + Voice Onboarding | v1.4 | team-cms | 0/TBD | Not started | — |

<details>
<summary>✅ v1.3 Pilot Hardening (Phases 18-21) — SHIPPED partial 2026-05-19</summary>

3 of 4 planned phases shipped; Phase 21 skipped (sole-user deferral). Plus un-roadmapped Neon-exit shipped 2026-05-21 (Mattermost + student DB → self-hosted Fly Postgres; all 3 Neon projects deleted). See `.planning/milestones/v1.3-pilot-hardening/SHIP-READY.md` and `infra/NEON-EXIT.md` for ship details.

- [x] **Phase 18: Graph Bridge Runtime** — Fly REST proxy + Workspace Worker rewire (commits be38369, 3449299, 1664d67, 1d13b1d)
- [x] **Phase 19: Todo Auto-Resolution** — cron infra + Resolved view + Undo (commits 6415650, 218d879, d03ff15, cdbc8ab). **Caveat:** cron inert until v1.4 CLOSETODO-01 writer ships.
- [x] **Phase 20: Pre-LLM Safety Screening** — Lakera helpers + insertion + `safety_events` table + `/ops/safety` (commits fd24477, 6f33854, 30ca491, 98cea02). **Caveat:** verification carried into v1.4 Phase 22.
- [ ] **Phase 21: Credential Rotation** — SKIPPED (sole-user). Reopens in v1.5 when first pilot user identifiable.

**Plus un-roadmapped Neon-exit (2026-05-21):** internjobs has zero Neon dependency. New Fly apps `internjobs-mattermost-db` + `internjobs-student-db`. Verification carried into v1.4 Phase 24.

</details>

<details>
<summary>✅ v1.2 Two-Sided Agent MVP (Phases 08-17) — SHIPPED 2026-05-19</summary>

178 commits, +71,340 net LOC, 16/17 phases fully shipped (Phase 14 code-shipped + runtime-blocked → resolved in v1.3 Phase 18). See `.planning/milestones/v1.2-two-sided-agent-mvp/` for full archive.

</details>

<details>
<summary>✅ v1.1 Seamless Waitlist (Phase 07) — SHIPPED 2026-05-15</summary>

Students sign in with LinkedIn, land on QR/SMS pairing, verify with 8-char code, follow-up texts route to thread. Durable handoff placeholders for Cognee + Sprite/Bright Data. See `.planning/milestones/v1.1-seamless-waitlist/` for archive.

</details>

<details>
<summary>✅ v1.0 Waitlist Foundation (Phases 01-06) — SHIPPED 2026-05-09</summary>

Marketing site + LinkedIn Clerk auth + Postgres schema + Photon/Spectrum SMS + welcome message + LinkedIn ingestion + ops health. See `.planning/milestones/v1.0-waitlist-app/` for archive.

</details>

---

## v1.5 Candidates (deferred polish + reopens + Startup Channels expansion)

**Startup channels (pilot-driven prioritization):**
- **STARTUP-SLACK-APP** — Custom Slack app, Viktor-pattern, vertical-simplified. Per-pilot OAuth install for v1; marketplace listing optional later. `@internjobs` mentions + DMs + `/internjobs` slash commands + push notifications into a startup-chosen channel. Build cost: 3–5 days MVP, 1 week pilot-grade. Defer until a pilot startup explicitly asks for Slack-native presence (Pattern A: Claude bridges Slack via the slack-mcp-plugin meanwhile).
- **STARTUP-EMAIL-INITIATED** — Email as a startup-INITIATED channel (currently agent-initiated only via existing reply-to aliases). Founder emails → reply-to alias → intent classifier → MCP `execute()`. ~3 days build. Pilots can use Ridhi-mediated email handoff until this lands.
- **STARTUP-DISCORD-APP** — Discord adapter for gaming/web3-leaning startups. Same bot-pattern as Slack. Defer until demand-gated by pilot signal.
- **STARTUP-TEAMS-APP** — Microsoft Teams adapter for enterprise startups. Bigger build (Bot Framework + tenant install), lower demand for pilot cohort. Defer indefinitely until enterprise pilot asks.
- **STARTUP-A2P-10DLC-MIGRATE** — Migrate Phase 29's toll-free Telnyx number to a local-looking A2P 10DLC number once SMS volume justifies the multi-week registration. v1.5+.
- **STARTUP-MULTI-MEMBER** — Founder invites cofounder/recruiter; shared startup view; per-member roles. Existing v1.4 backlog item `MULTI-MEMBER-01` extended for the startup side specifically.

**Carryovers from earlier scope work:**
- **SEC-ROTATE-ALL** — Reopens from v1.3 Phase 21 when first pilot user is identifiable. RUNBOOK preserved.
- **DAILY-VANITY-01** — Custom Daily.co subdomain `meet.internjobs.ai`. Scale-plan upgrade gate.
- **AGENTIC-INBOX-TESTS** — Test coverage for `apps/agentic-inbox/workers/` (zero `.test.ts` files today).
- **INTEG-01-PROD-RUN** — Two-sided 11-step smoke executed in production by a human operator (never run since v1.2).
- **SAFETY-OUTBOUND-01** — Lakera Guard on agent outbound messages (gate: first pilot reputational-harm report).
- **SAFETY-HARD-BLOCK-EXPAND-01** — Convert student SMS soft-flag → hard-block once 30 days of pilot FP data exists.
- **MAC-BRIDGE-ALERTING** — Monitor BlueBubbles + tunnel health.
- **WORKERS-VPC-REVISIT** — Retire `internjobs-graph-api` Fly proxy if Workers VPC GA with viable pricing.
- **KGRAPH-METRICS** — Quantitative metric on duplicate-todo-rate reduction (qualitative pass in v1.4).
- **PARROT-NAME-AUDIT** — Decide whether to rename `apps/parrot/` → `apps/workspace/` (cosmetic).

---

**Next Steps:**
1. (Optional) `/rrr:assign-phases` — formalize team assignments per phase in `.planning/team-mode.json`
2. `/rrr:plan-phase 22` — Build the execution plan for Phase 22 (Lakera Production Verification) — *team-cms*
3. In parallel: `/rrr:dispatch-team --team team-workspace` to prep the Workspace branch
4. Optionally `/rrr:discuss-phase 22` first to surface implementation context
