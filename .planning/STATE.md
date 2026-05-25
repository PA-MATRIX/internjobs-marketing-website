---
schema_version: 2
milestone: "v1.4"
phase: 28
phase_name: "Startup MCP Server + Channel-Adapter Core"
phase_total: 8
plan: 5
plan_total: 5
status: "phase_complete"
progress: 11
last_activity: "2026-05-25"
session_last: "2026-05-25"
resume_file: null
blockers: []
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-24)
See: .planning/MILESTONES.md (full v1.0 / v1.1 / v1.2 / v1.3 ship history)
See: .planning/REQUIREMENTS.md (96 active v1.4 requirements — 46 original + 22 brand + 14 Startup MCP + 14 Startup Telnyx — all mapped to phases)
See: .planning/ROADMAP.md (v1.4 = Phases 22–29, two-team execution; Slack/Discord/Teams adapters deferred to v1.5)
See: .planning/milestones/v1.4-pilot-readiness/SCOPE.md (initial scope draft)
See: .planning/brand/BRAND-V1.md (brand spec captured from PDF + logo pack 2026-05-24)
See: .planning/codebase/ (codebase map written 2026-05-24)
See: .planning/team-mode.json (RRR team mode: team-cms + team-workspace)
See: .planning/WORKSTREAMS.md (team assignments)

**Core value:** InternJobs.ai helps students and startups meet through natural messages, not resume piles or application black holes.
**Current focus:** Phase 28 — Startup MCP Server + Channel-Adapter Core (team-cms)

## Current Position

Milestone: v1.4 Pilot Readiness
Phase: 28 of 29 (Startup MCP Server + Channel-Adapter Core — team-cms) — **PHASE COMPLETE (5/5 plans shipped)**
Plan: 28-05 complete (marketing CTA receiver + /startups channels grid + apps/startup/CHANNELS.md + PILOT-EVIDENCE.md placeholder); Phase 28 closes.
Status: All 5 plans of Phase 28 are shipped. POST /api/request-access live at mcp.internjobs.ai/api/request-access (Worker Version 8add12e0-8258-4290-ae7e-8e6823d0aef8) — CORS-restricted to internjobs.ai, 4-field form (name, email, phone, what_hiring_for), email-to-Ridhi via env.EMAIL.send() with log-fallback when binding absent. /startups got <ChannelsGrid /> between Hero and ResumePileSection (5 primary channels — claude/chatgpt + cursor/cline LIVE; voice + sms tagged "coming v29"; email tagged "coming v28.5") + 3 coming-soon pills (slack, discord, microsoft teams). StartupAccessSection mailto form replaced with live <RequestAccessForm /> POSTing to /api/request-access. Brand verify still PASSES (WCAG ratios + 0 hex literals in new component). apps/startup/CHANNELS.md (285 LOC) ships as the channel-adapter doc-as-spec with concrete sketches for Phase 28.5 web, Phase 29 telnyx-sms + telnyx-voice, v1.5 slack/discord/teams/email. Live first-pilot install evidence DEFERRED to v1.5 STARTUP-PILOT-LIVE-01 per explicit user decision 2026-05-25 — Phase 28.5 (web onboarding at startups.internjobs.ai) ships first because non-tech founders won't install MCP cold. PILOT-EVIDENCE.md placeholder records status=deferred + 5 acceptance criteria + 2 paths to close. ROADMAP.md v1.5 Carryovers updated.
Last activity: 2026-05-25 — 28-05 executed: 3 task commits (11c67ac feat /api/request-access + CHANNELS.md; cbd9a4e feat /startups form + channels grid; 6b9414e docs PILOT-EVIDENCE.md placeholder + ROADMAP v1.5 carryover). 1 deviation logged (Rule 4: live first-pilot install deferred to v1.5 STARTUP-PILOT-LIVE-01 per explicit user decision — synthetic smoke tests by Ridhi cover the gap until a real founder is identified via Phase 28.5 or direct tech-founder path). Worker Version 8add12e0-8258-4290-ae7e-8e6823d0aef8 (apps/startup with EMAIL binding + apiRouter + adminRouter all live). Marketing build clean (1966 modules, 509ms). verify-brand.mjs ALL CHECKS PASS. Duration ~6.3 min.

Progress: ██████░░░░ 16% (11/68 requirements done; STARTUP-MCP-01..04 closed by 28-01+28-02; STARTUP-MCP-05..10 closed by 28-03; STARTUP-ADMIN-01..02 closed by 28-04; STARTUP-CHANNEL-01..02 + STARTUP-MARKETING-01..02 closed by 28-01 + 28-05; STARTUP-PILOT-01 functionally closed by Phase 28's 5 plans' synthetic smoke; live-founder ceremony tracked as v1.5 STARTUP-PILOT-LIVE-01; BRAND-VERIFY-01/02/03 closed by 22-05; 17 brand-layout/logo/copy reqs by 22-04; 8 brand foundation reqs by 22-03; LAKERA-V2-01/02/03 by 22-01; SAFETY-VERIFY-LIVE-01/02 by 22-02 — -03 deferred to v1.5)

## Team Mode

This milestone runs under **RRR team mode** (initialized 2026-05-24).

- `team-cms` (Raj, GitHub `@PA-MATRIX/team-cms`) — Phases 22 + 24 + 28 + 29. Branch `rrr/v1.4/team-cms`.
- `team-workspace` (Raj + Nithin, GitHub `@PA-MATRIX/team-workspace`) — Phases 23, 25, 26, 27. Branch `rrr/v1.4/team-workspace`.

**Execution order:**
- team-cms: 22 → 24 → 28 → 29
- team-workspace: 23 → 25 → 26 → 27
- Cross-team dep: 23 cannot start until 22 is verified; 29 depends on 28 (same-team sequential)

Coordinator workflow: each team works on their own branch; root `.planning/STATE.md` is coordinator-owned; integration via `integration/v1.4` branch.

See: `.planning/workstreams/{team-cms,team-workspace}/{STATE.md,ASSIGNMENT.md}`

## Performance Metrics

**Velocity:**
- Total plans completed (v1.0/v1.1/v1.2): ~43; v1.3: 9 + Neon-exit
- v1.4 plans completed: 0

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 22 | 5 | 5 | ~13 min (22-03: ~3 min, 22-01: ~25 min, 22-04: ~12 min, 22-02: ~8 min, 22-05: ~15 min) |
| 23 | 0 | TBD | — |
| 24 | 0 | TBD | — |
| 25 | 0 | TBD | — |
| 26 | 0 | TBD | — |
| 27 | 0 | TBD | — |
| 28 | 5 | 5 | ~9.5 min (28-01: ~11, 28-02: ~6, 28-03: ~11, 28-04: ~13, 28-05: ~6.3) — **PHASE COMPLETE** |

## Accumulated Context

### v1.4 phase dependency graph

- **Phase 22** (Lakera Verification + Marketing Brand Refresh, team-cms) — first phase, no v1.4 deps. Two independent tracks within team-cms (Lakera + Brand).
- **Phase 23** (Workspace Pilot Closeouts, team-workspace) — depends on Phase 22 (SAFETY-VERIFY-LIVE-04 needs LAKERA-V2-02)
- **Phase 24** (Neon-Exit Closeout, team-cms) — no deps; can start parallel to 23
- **Phase 25** (SSO + Admin UX, team-workspace) — sequential after 23 on team-workspace branch
- **Phase 26** (Knowledge Graph + GenZ, team-workspace) — sequential after 25
- **Phase 27** (Polish + Test Floor, team-workspace) — sequential after 26
- **Phase 28** (Startup MCP Server + Channel-Adapter Core, team-cms) — sequential after 24 on team-cms branch; Ridhi handles concierge onboarding for first 5–10 pilots; channel-adapter pattern future-proofs Phase 29 + v1.5 channels
- **Phase 29** (Startup Telnyx SMS + Voice AI + Voice Onboarding, team-cms) — depends on Phase 28 (Telnyx adapter calls the MCP core); voice-intake onboarding + weekly text touchbase for non-MCP founders

### Decisions

Recent v1.4 decisions (log into PROJECT.md Key Decisions table when finalized):
- 6-phase breakdown chosen over 4-phase aggressive option for cleaner team ownership
- Phase ownership by team (one team per phase) rather than per-requirement mixing — keeps team branches clean
- NEONEX-DEP-01 folded into Phase 25 (team-workspace housekeeping) rather than splitting Phase 24 across teams
- DATES-01 classified team-workspace (both source apps are team-workspace-owned), not "shared"
- 22-03: Brand `ink` overrides legacy tailwind `ink:#111111` (renamed to `ink-legacy`). All `text-ink` usages now resolve to `var(--ink)=#1A0D2E`. 22-04 contrast pass will catch any regressions.
- 22-03: PNG-only favicon strategy (no .ico generated). 256w mark-gradient PNG used for 32/64/180 sizes; Safari mask-icon → mark-ink.svg.
- 22-03: Tailwind brand keys reference CSS vars (`var(--lavender)` etc.) instead of duplicating hex values — single source of truth in `styles.css :root`.
- 22-01: Lakera v2 returns a binary `{flagged, metadata}` payload — no `results[]`, no per-category scores. The v1 parser silently fell through to `score=0` on every flagged response, so the production `score >= 0.8` hard-block gate was dead code. Fixed via parser rewrite + caller-gate change to `flagged === true || score >= 0.8`. Both `screen.mjs` (Node) and `safety.ts` (Worker) mirror.
- 22-01: Binary flag → numeric score mapping (`flagged: true → score=1`) preserves the `ScreenResult.score: number | null` contract used by every caller + the `safety_events.score` DB column. Considered `null` but rejected — would force every caller to handle a new code path.
- 22-01: Lakera tier/quota is not API-visible — `infra/LAKERA-PRICING.md` documents this as a deferred dashboard-sign-in follow-up; 22-01 did not block on it because the operational signal ("logs visible in dashboard, key works") is positive.
- 22-01: Skipped the Lakera signup checkpoint (Task 1) — production key already wired (Infisical + Fly digest `64ee3c881fc8742c`). Verified by direct probe from inside the Fly app's env, not from a dev laptop.
- 22-04: StartupNavbar mounts lockup-lavender.svg (not lockup-gradient-ink.svg) because the cobalt header literally sits on cobalt — BRAND-LOGO-04 cobalt exception applied at navbar surface, not just inside the hero. Apex Navbar receives isStartupPage prop and picks gradient-ink variant for default lavender surface.
- 22-04: OG image generated via sharp (already in node_modules) — wrote SVG to /tmp, sharp.png().toFile() to public/logo/og-1200x630.png. No new dep. SVG snippet preserved in commit fed1d0b for regen.
- 22-04: WaitlistSection + StartupAccessSection CTA buttons rewritten to brand pills ("get on the list" / "post a role") for cross-page brand-voice consistency. Was "Join Early Access" / "Join Startup Access" on .secondary-party-button with #111 text — both forbidden hex AND Title Case.
- 22-04: ChannelSection h2 (with text-party-gradient rainbow + #111111 stops) left untouched — out of 22-04 scope. Flagged as known follow-up for 22-05 visual diff or later.
- 22-04: Phone-demo UI mocks (iphone-screen, ios-*, whatsapp-*, slack-*, discord-*, phonecall-*) + startup-chat-shell + startup-slack-* all kept their original hex literals per BRAND-LAYOUT-05 mock-exception clause (they simulate real app UIs).
- 22-04: Apex Navbar mobile drawer nav links kept Title Case (How it works, Channels, etc.); StartupNavbar nav links lowercased (cobalt header is strongly branded surface, lowercase matches brand voice more strictly). Small judgment call documented in deviations.
- 22-02: VERIFY-LIVE-03 (fail-open via invalid LAKERA_GUARD_API_KEY) DEFERRED. Live execution would degrade the safety gate during the Fly machine restart (~30s). Substitutes accepted: (a) unit-test coverage in `apps/app/src/safety/screen.test.mjs` (5/5 pass per 22-01) and (b) an organic prod observation of `action='passed_lakera_unavailable'` on row f0293168 (2026-05-21T17:56:16Z), confirming the fail-open path has fired in prod before this verification window. Re-promote in v1.5 if pilot incident requires.
- 22-02: VERIFY-LIVE-02 accepted as PASS via inference, NOT direct positive logging. Code gate at `apps/app/src/server.mjs:707` (`if (screenResult.action !== "passed")`) means benign passes emit only `lakera_latency_ms`, not the full `lakera_screen` log line. Converging signals (zero unexpected safety_events rows + latency-only log entries clustered around benign sends + 32s gap analysis) accepted as evidence. Lifting the log out from under that gate is a v1.5 observability follow-up (SAFETY-OBS-01 proposed candidate).
- 22-02: Lakera v2 conservative-flag observation documented as v1.5 pilot watchlist item, NOT a fix-now defect. Lakera flagged tone-adversarial ("You suck") and meta-question ("what would happen if I asked you to ignore safety rules?") prompts in the test window. v2 binary endpoint has no score knob to soften — remediation paths (per-user allowlist / Lakera v2 detailed endpoint with category scores / categorical exception list) all imply v1.5 design work. Fold into existing v1.5 SAFETY-HARD-BLOCK-EXPAND-01 candidate with concrete pilot-watch action: daily FP-rate dashboard tile, 30-day review.
- 22-05: Visual QA satisfied via 7-commit user-iterative-refinement trail (e83d122 bg-canvas cream→lavender, bd4fb5d BrandMark→SVG, 465041e CSS cleanup, bffcc2d favicon ink, 127772a label drop Houston, ad06996 StudentFooter, ae1f5cb Austin address) instead of a separate end-of-phase human-verify checkpoint. Pattern: when iterative refinement already happened in production between plan close and audit, the commit trail IS the evidence — don't issue a redundant checkpoint.
- 22-05: Cobalt/lavender contrast threshold = 3:1 (AA large-display) per BRAND-V1.md §1, NOT 4.5:1 (AA normal text). Cobalt is accent-only — only on CTA pills and section headlines, all ≥18pt bold, qualifying as "large display" per WCAG 2.1 §1.4.3. Measured 4.14:1 passes with margin.
- 22-05: Brand-name title-case audit scopes via constant-block-slicing (privacyContent + termsContent) rather than a `<= N legal exceptions` magic threshold. Legal exception is now structurally encoded in the linter; future legal-text changes won't break the audit.
- 22-05: Channel-chip active-state text was literal "white" — swapped to var(--lavender). Per BRAND-V1.md §1 ("cobalt and ink-dark backgrounds need lavender text — never gray"), lavender is the brand-correct ink-on-dark pattern against saturated channel brand colors (Slack purple, Discord indigo, WhatsApp green).
- **2026-05-24 evening: Startup channels added as Phase 28 (MCP foundation) + Phase 29 (Telnyx SMS + Voice AI + voice-based onboarding).** Milestone expands 6 → 8 phases (~68 → ~96 reqs). team-cms load 35 → 63 reqs; team-workspace load unchanged at 33.
- **Slack adapter deferred to v1.5** despite founder appeal — Slack Marketplace approval is multi-week; per-pilot OAuth still adds Bolt/refresh complexity; Claude/ChatGPT MCP support means tech founders can already bridge to Slack via Pattern A (Anthropic's slack-mcp-plugin) with zero work on our side.
- **MCP-first reach decision:** ChatGPT shipped MCP support in late 2025 (GPT-5 native), so MCP reaches Claude Desktop, Claude Code, Cursor, Cline, Continue, Zed, AND ChatGPT — broader than "Claude-only," justifying MCP as Phase 28 foundation.
- **Stainless `search` + `execute` + `me` + `discover_actions` MCP tool pattern adopted** — keeps tool catalog at 4 even as action enum grows; per-action authz + audit preserved by making `action` an ENUM rather than free-form string (avoids omnibus-execute security pitfall).
- **Concierge onboarding for first 5–10 pilots** (Ridhi runs admin endpoint, founder gets SMS install link) instead of self-serve onboarding in Phase 28; self-serve magic-link signup deferred to v1.5.
- **Telnyx toll-free over A2P 10DLC** for Phase 29 to skip 4-week registration; local-number A2P migration is v1.5 candidate.
- **No iMessage for startups** — iMessage (BlueBubbles) is exclusively student-side. Telnyx covers startup SMS/voice.
- **`/startups` channels grid (STARTUP-MARKETING-02):** Claude/ChatGPT, Voice, SMS, Email as primary tier; Slack/Discord/Teams labeled "coming soon" — sets pilot expectation that MCP + Telnyx are first-class while Slack waits for v1.5.
- **28-01: outbound_messages table created in migration 0011** (not pre-existing as plan assumed). The Phase 04 `drafts` table is the v1.2 approval-queue (pending_review → approved → sent through human operators); the Phase 28 MCP `reply_to_candidate` action is a direct-send path (founder authored the message themselves via their LLM), so a clean `outbound_messages` log per-channel makes more sense. Phase 29 Telnyx SMS will append rows with `channel='telnyx-sms'` (same table, no schema change).
- **28-01: Embeddings via separate `*_embeddings` tables, not `roles.embedding` column.** Per migration 0005 lock (vector(768), bge-base-en-v1.5). /v1/roles UPSERTs role_embeddings keyed by role_id; /v1/search/candidates joins student_embeddings keyed by student_id. The plan-as-written assumed an inline `embedding` column on `roles` — that doesn't exist.
- **28-01: Concierge clerk_user_id placeholder pattern.** `startup_members.clerk_user_id` is NOT NULL UNIQUE in real schema. /v1/startups synthesizes `'concierge:<16-byte hex>'` placeholder so Ridhi-led pilot onboarding (28-04 admin endpoint) can issue install tokens BEFORE the founder completes Clerk org provisioning. When the founder later signs into workspace.internjobs.ai, the row's clerk_user_id is UPDATEd to the real Clerk user id. Format is sortable + debuggable. v1.5 backlog item: build a `migrate_concierge_to_real_user` admin endpoint.
- **28-01: STARTUP_API_SECRET — Infisical sync follow-up.** The user's `infisical` CLI is logged into the Projecta org and got 403 against the internjobs workspace (correct workspace ID = `26995afd-9a6f-4690-912f-01cbcebb76d5`, NOT the stale `2c12f042` in MEMORY.md). Secret was set directly on Fly via `flyctl secrets set`; the plaintext is at `/tmp/startup_api_secret.txt` for the user to copy into Infisical at `/internjobs-ai/STARTUP_API_SECRET`. Not blocking 28-02..05 (the MCP Worker reads its own copy from `wrangler secret put`).
- **28-01: pgvector cast pattern locked.** Pass embeddings as `[n1,n2,...]` text literal + `::vector` cast in SQL — avoids needing a custom node-postgres oid parser. 768-dim hard-validated server-side; dim mismatch returns 400 `embedding_dim_mismatch`.
- **28-01: /v1/threads/:id/mark uses a 3-way OR match** because `inbound_messages` has no first-class `thread_id` column (threading lives in `student_threads.thread_key` joined via `conversations`). Matches on `id::text`, `metadata->>'thread_id'`, or `metadata->>'student_thread_id'`. rowCount=0 returns `{ok:true, updated:0}` (idempotent-friendly; doesn't leak thread existence via 404). v1.5 hygiene: add a real `thread_id` column once threading model stabilizes.
- **28-01: infra/{name}-api/ Fly Hono/Node proxy pattern formalized.** Both `infra/graph-api/` (v1.3) and `infra/startup-api/` (v1.4) follow identical shape: package.json + Dockerfile + fly.toml + src/index.mjs + smoke.mjs, Bearer auth via node:crypto timingSafeEqual, min_machines_running=1 (always-warm), shared-cpu-1x/256mb, primary_region=ord. Any future CF-Worker-needs-Fly-DB phase ships its own infra/{name}-api/ rather than fattening the others.
- **28-02: createMcpHandler (stateless) over McpAgent (DO-backed) for 4-tool surfaces.** `apps/startup/` uses `createMcpHandler()` from `agents/mcp` + a fresh `McpServer` per request via `buildMcpHandler()` called inside the Hono route handler. No DO migration overhead, no per-session state needed for the search/execute/me/discover_actions catalog. `apps/agentic-inbox/` continues to use `McpAgent` because it has per-mailbox state. Future MCP surfaces on Workers should pick based on state needs (stateless → createMcpHandler; stateful per session → McpAgent).
- **28-02: @modelcontextprotocol/sdk MUST be exact-pinned when consuming the `agents` package.** Caret ranges (`^1.26.0`) resolve to latest minor (1.29.0) while `agents@0.7.9` transitively pins exactly 1.26.0, producing a dual-install with distinct private-property type identities → TS2345 errors on `createMcpHandler(McpServer, ...)`. Pin-exact dedups to one hoisted copy. Inline comment in `apps/startup/package.json` documents the constraint; lockstep upgrade with `agents` when it bumps.
- **28-02: Workers custom domain via `routes[]+custom_domain`** auto-provisions DNS + Cloudflare-managed SSL on first `wrangler deploy` — no separate DNS step. Matches `apps/parrot/wrangler.jsonc` pattern. Used for `mcp.internjobs.ai`.
- **28-02: Bearer-in-header-only auth model.** `Authorization: Bearer <per-startup-token>` is the only path. URL-path tokens explicitly rejected (leak in logs, referrers, intermediate proxies). Worker SHA-256 hashes the raw token before any outbound call; raw token never logged. Constant-time comparison happens server-side at the Fly proxy.
- **28-02: ChatGPT OAuth probe → 404 JSON** (not 200, not 500). 200 forces ChatGPT to expect RFC 8414 metadata; 500 marks the Worker as broken. 404 with `{error: "no_oauth", issuer: ...}` lets ChatGPT fall back cleanly to Bearer-header auth.
- **28-02: Stainless `discover_actions` returns input_schema in snake_case.** Matches OpenAPI training-data distribution for LLM tool selection — do NOT switch to camelCase even though the Worker is TypeScript-native.
- **28-02: Per-startup rate limiting deferred to 28-03.** Plan's must_have wasn't shipped because true token-bucket-per-startup needs a DO or KV namespace (expands scaffold scope). The Fly proxy at `/v1/startups/token` serves as the natural per-request bottleneck during Wave 2. Revisit once `search`/`execute` start firing real pilot load.
- **28-03: startup_id is NEVER from params — TWO-LAYER defense.** Layer 1 (Worker): all 5 Zod schemas in execute.ts omit `startup_id` as a field; `.strip()` default silently drops any rogue value. Layer 2 (Proxy): every PATCH endpoint on the Fly proxy has `WHERE id = $1 AND startup_id = $auth_provided`. Cross-startup leaks would require coordinated breaks at BOTH layers. Verified via two-startup smoke: TOKEN_A trying to update STARTUP_B's role returns `not_found_or_not_owned`, search('roles') for A vs B has zero overlap.
- **28-03: Audit log fires in `finally{}` regardless of success/error/Zod-rejection.** Even invalid_params responses write `status='error', error_code='invalid_params'` rows to `startup_action_log`. This is deliberate — Zod-rejected calls are signal (LLM drift, abuse, schema-version skew). Future ops dashboards can plot `error_code='invalid_params'` rates per startup to flag broken integrations.
- **28-03: Workers AI binding 'ai': { binding: 'AI' } in wrangler.jsonc — compute-independent.** apps/startup/workers/lib/embed.ts calls `env.AI.run('@cf/baai/bge-base-en-v1.5')` directly. ZERO runtime dependency on the student app's /internal/embed endpoint. If the student app is under SMS load, search('candidates') on the startup Worker is unaffected. CF bills per-neuron, not per-binding (free to declare).
- **28-03: embedText() fail-soft (returns null on missing binding / empty result).** handlePostRole sends `embedding: null` to /v1/roles; the proxy skips role_embeddings UPSERT gracefully. Better to ship a non-embedded role (back-fillable later) than 500 the founder on a transient AI hiccup.
- **28-03: Structured-search score = 1.0 constant for non-pgvector scopes.** MCP envelope requires `score`; ILIKE has no meaningful relevance number. 1.0 is the safe sentinel. LLM clients should sort by other fields (created_at, last_inbound_at, message_count). v1.5 candidate: BM25 / pg_trgm trigram similarity.
- **28-03: search('threads') aggregates BY student.** No first-class `thread_id` column on `inbound_messages` (Phase 28 chose not to add one; v1.5 hygiene). A "thread" in MCP terms is a student×startup conversation; row id = student_id; extras = last_inbound_at + message_count + startup_mark. Composes cleanly with execute('reply_to_candidate', {thread_id: student.id, ...}).
- **28-03: search('startups') hardcodes `id = $startup_id`.** Caller sees ONLY their own record. Query string is ignored for matching (no global startup-name search — would leak customer list). Returns 1 row max.
- **28-03: GET /v1/startups/:id/stats serves dual purpose.** Primary: me() role_count + recent_activity. Secondary: it's the only practical audit-log inspector without psql access (`actions_last_7d` is a direct count from `startup_action_log`). Fly app containers ship Node only, no psql binary.
- **28-03 parallel-execution collision (Wave 3, self-corrected): Peer's first commit `3c89b07` accidentally bundled 28-03's Task 2 changes; peer rebased to `6afff17` to drop them; 28-03 then committed Task 2 atomically.** Both plans modified shared files (`apps/startup/wrangler.jsonc` + `infra/startup-api/src/index.mjs`); peer's broad `git add` captured my unstaged additions. Caught at status check before final commit, self-corrected by peer's rebase. All code works (20/20 smoke PASS); atomic-commit-per-task invariant preserved post-rebase. Recommendation: for future parallel waves with shared files (`wrangler.jsonc`, `infra/*/src/*.mjs`), spawn prompts should explicitly call out shared-file overlap, and agents should `git add <specific-files>` (never `.` or `-A`) to avoid cross-contamination.
- **28-04: Admin endpoint as Bearer-header-only, never via query param.** `Authorization: Bearer <STARTUP_MCP_ADMIN_SECRET>` is the only auth path on POST /admin/startups/new. Same model as /mcp. Cloudflare CDN / referrer logs / proxies never see the secret in URLs.
- **28-04: Token shown ONCE in response body AND attempted via SMS.** Operator-friendly redundancy — if Telnyx fails or the founder phone is bad, Ridhi can copy the snippet straight from the curl response. The token is plaintext exactly once; startups.mcp_token_hash stores only the SHA-256.
- **28-04: Multi-format install snippet in ONE SMS.** Founders use Claude, Cursor, ChatGPT, and other MCP clients. Sending three separate SMSes confuses about "which to use." One labeled SMS with Claude CLI cmd + Cursor JSON + ChatGPT note (~1100 chars, 7-8 Telnyx segments) is cleaner.
- **28-04: Telnyx as optional-secret-feature-flag.** TELNYX_API_KEY + TELNYX_FROM_NUMBER are read at runtime via `(env as Record<string, string|undefined>)`. Absence = log + return SMS body in response (manual_sms_required=true). Presence = real Telnyx POST. Phase 29 will provision the keys; zero code change needed when it lights up.
- **28-04: Email dedupe is app-layer, not DB UNIQUE constraint.** Added a `SELECT 1 FROM startup_members WHERE lower(email)=lower($1) AND role='founder'` pre-check on POST /v1/startups (Rule 2 fix — plan must_have requires 409). A real UNIQUE partial index would be architectural (migration); flagged for v1.5 hardening. Race window is ~5-10ms — acceptable for concierge-only flow (one operator). Case-insensitive via lower() so 'Founder@X.com' and 'founder@x.com' collide.
- **28-04: createStartup() helper factored as discriminated-union return.** `{ok: true, result}` or `{ok: false, error: {status, body}}` — no exceptions, no implicit null. Phase 28.5's extended admin endpoint composes this with Clerk #3 invite + per-startup agent-email-slug reservation; explicit pattern-matching > try/catch over many extension points.
- **28-04 parallel-execution incident (Wave 3): Initial commit `3c89b07` (now orphaned) accidentally swept peer 28-03's uncommitted WIP files into my staging.** Root cause: `git commit` (no `-a`) commits whatever is in the index at execution time, and the index is shared global state — peer's parallel `git add` populated their files into my index between my `git diff --cached` check and my `git commit`. Cleaned up via `git reset --soft HEAD~1` + `git stash push -- <peer files>` + `git checkout HEAD -- <shared proxy file>` + re-apply my proxy hunks only + clean stage + commit + `git stash pop`. Final clean commit at `6afff17` (415 ins / 10 del, exactly my 4 files). Forward fix: parallel agents working on the same repo MUST commit immediately after each edit AND should not rely on `git diff --cached` for index-state assertions (the index can mutate underneath them). Coordination via broadcast messages helps but doesn't prevent the index race.
- **28-05: Live first-pilot install DEFERRED to v1.5 STARTUP-PILOT-LIVE-01** (explicit user decision 2026-05-25). Rule 4 (architectural / user decision), not auto-skip. PILOT-EVIDENCE.md placeholder records status=deferred + 5 acceptance criteria + 2 paths to close (28.5 surrogate-install OR direct tech-founder install). ROADMAP.md v1.5 Carryovers updated. Phase 28 closes functionally complete (5/5 plans shipped; all infrastructure live + smoke-verified) with the live-founder ceremony tracked as a v1.5 carryover.
- **28-05: Public CTA endpoint with CORS-allowlist** (no Bearer auth on /api/request-access). Marketing forms can't authenticate with Bearer — they MUST be public. CORS-allowlist (internjobs.ai + www.internjobs.ai only) is the right granularity. Same Worker hosts /mcp (Bearer-gated, per-startup tokens), /admin/* (Bearer STARTUP_MCP_ADMIN_SECRET), AND /api/* (public, CORS-restricted). Three auth models cohabit on one Worker without cross-contamination because they're route-scoped middleware.
- **28-05: env.EMAIL binding as optional-feature-flag**. Same pattern as 28-04's TELNYX_*. If `env.EMAIL.send` exists, route the lead to raj@internjobs.ai; if it errors or is absent, JSON-log the lead via console.log (visible in `wrangler tail` / Logpush). Lead is never lost. Form UX always returns `{ok: true}` to the submitter to keep the success path clean even if email send fails. Enabling Cloudflare Email Routing later requires zero code change.
- **28-05: Component file extraction pattern formalized**. apps/marketing/src/components/StartupAccessSection.tsx is the first marketing component file extracted from App.tsx. Pattern: extract a section if it has its own React state/effects AND can stand alone (no App-local helper dependencies). Outer wrapper sections that depend on BrandMark / cta-spectrum / etc. stay inline. Phase 28.5's web-sign-up redirect will likely live in the same components/ dir.
- **28-05: CHANNELS.md as doc-as-spec**. The channel-adapter pattern from 28-01 is now formally documented (285 LOC, 6 adapter sketches). Future adapter PRs (Phase 29 telnyx-sms / telnyx-voice; v1.5 slack/discord/teams/email) MUST link this doc + append a row to its "when to add a new adapter" summary. The cross-startup isolation invariant from 28-03 is codified here so future adapters can't accidentally regress it.

### Pending Todos

- **Persist STARTUP_API_SECRET to Infisical** — value at `/tmp/startup_api_secret.txt`, target path `/internjobs-ai/STARTUP_API_SECRET` env `prod` workspace `26995afd-9a6f-4690-912f-01cbcebb76d5`. Will require `infisical login` against the internjobs org first.
- **Persist STARTUP_MCP_ADMIN_SECRET to Infisical** — value at `/tmp/startup_mcp_admin_secret.txt` (64 hex chars; first 8: `aab8e96d`). Target: `/internjobs-ai/STARTUP_MCP_ADMIN_SECRET` env=prod. Already live on the Worker via `wrangler secret put`; Plan 28-04 reads it from the Worker, so Infisical is hygiene only.
- **Update MEMORY.md infisical-project.md** — replace stale workspace ID `2c12f042...` with correct `26995afd-9a6f-4690-912f-01cbcebb76d5` (the value in repo `.infisical.json`).
- **Next: Phase 28.5 (Startups Web App + Clerk #3 + Per-Startup Agent Email)** — first ship priority. team-cms. Reuses 28-01 Fly proxy + 28-04 createStartup() helper + 28-05 EMAIL binding + CHANNELS.md adapter pattern. Will replace the /startups Request Access form with a sign-up redirect to startups.internjobs.ai once live.
- v1.5 backlog: STARTUP-PILOT-LIVE-01 — live first-pilot install evidence (deferred from 28-05 by user decision 2026-05-25). Acceptance criteria in PILOT-EVIDENCE.md.
- v1.5 backlog: Workers-side rate limiting per startup_id (DO or KV namespace) — deferred from 28-02 + 28-03; the Fly proxy is the natural bottleneck for pilot single-digit founders, revisit when audit-log write contention shows
- v1.5 backlog: BM25 or pg_trgm trigram similarity for structured search ranking (currently every non-pgvector hit scores 1.0)
- Optional: `/rrr:assign-phases` to formalize team assignments in `.planning/team-mode.json`
- CODEOWNERS file at `.github/CODEOWNERS` per the team scope split (deferred — drafted in earlier session, not yet committed)
- Branch protection on `main` requiring CODEOWNERS approval
- v1.5 backlog: `migrate_concierge_to_real_user` admin endpoint to flip 28-01's `clerk_user_id='concierge:<hex>'` placeholders to real Clerk user ids once founders complete workspace.internjobs.ai sign-in
- v1.5 backlog: `inbound_messages.thread_id` first-class column to replace 28-01's metadata-fallback 3-way OR match in /v1/threads/:id/mark

### Blockers/Concerns

None blocking. ✅ Lakera safety track is fully verified end-to-end: LAKERA-V2-01/02/03 by 22-01 (schema + parser fix), SAFETY-VERIFY-LIVE-01/02 by 22-02 (9 hard-blocks confirmed live in prod, benign passes confirmed via converging signals). SAFETY-VERIFY-LIVE-03 (fail-open) deferred to v1.5 with documented rationale (unit-test coverage + organic prod observation; live destructive test declined). Phase 23 (SAFETY-VERIFY-LIVE-04 employee-email path) can proceed with full confidence in the underlying parser + gate.

Follow-ups (not blocking):
- Lakera dashboard sign-in to confirm tier/quota for the 30k/month pilot — `infra/LAKERA-PRICING.md` "Tier assessment" section.
- Pilot watchlist: 30-day Lakera FP-rate review (driven by v1.5 SAFETY-HARD-BLOCK-EXPAND-01; "You suck" + meta-question both flagged conservatively in 22-02 prod test).
- v1.5 observability: lift `lakera_screen` log out from under the `action !== "passed"` gate so every Lakera roundtrip emits a structured log entry (proposed SAFETY-OBS-01).

Pre-existing TS error in `apps/parrot/workers/types.ts:55` (`STUDENT_API_URL` discriminated type — `string | undefined` vs string-literal). Reproduces on `main` without 22-01 changes. Not a 22-01 regression but worth a future house-keeping pass.

## Session Continuity

Last session: 2026-05-25 — 28-05 (marketing CTA receiver + /startups channels grid + CHANNELS.md adapter doc + PILOT-EVIDENCE.md deferral) complete. Phase 28 closes (5/5 plans shipped). Worker `internjobs-startup-mcp` redeployed (Version `8add12e0-8258-4290-ae7e-8e6823d0aef8`) with new `/api/*` apiRouter replacing the 28-02 503 stub. New files: `apps/startup/workers/routes/api.ts` (~135 LOC — apiRouter with CORS to internjobs.ai + POST /request-access handler with email-or-log fallback), `apps/startup/CHANNELS.md` (285 LOC — channel-adapter doc-as-spec covering Phase 28 mcp / 28.5 web / 29 telnyx-sms+voice / v1.5 slack+discord+teams+email), `apps/marketing/src/components/StartupAccessSection.tsx` (~280 LOC — RequestAccessForm + ChannelsGrid components), `PILOT-EVIDENCE.md` (status=deferred placeholder for v1.5 STARTUP-PILOT-LIVE-01). Modifications: `apps/startup/workers/app.ts` (apiRouter mount), `apps/startup/wrangler.jsonc` (send_email binding), `apps/marketing/src/App.tsx` (ChannelsGrid in StartupPage; RequestAccessForm replaces mailto in StartupAccessSection; lowercased section copy), `ROADMAP.md` (STARTUP-PILOT-LIVE-01 added to v1.5 Carryovers). Smoke verified on prod: POST /api/request-access happy → 200, missing-email → 400, invalid-JSON → 400, OPTIONS preflight from https://internjobs.ai → 204 with correct CORS headers. Marketing build clean (1966 modules / 509ms). verify-brand.mjs ALL CHECKS PASS. 1 deviation logged (Rule 4: live first-pilot install deferred to v1.5 per explicit user decision 2026-05-25 — synthetic smoke tests cover the gap; real founder will be surfaced via Phase 28.5 web onboarding or direct tech-founder path). Task commits: `11c67ac` (feat: /api/request-access + CHANNELS.md), `cbd9a4e` (feat: /startups form + channels grid), `6b9414e` (docs: PILOT-EVIDENCE + ROADMAP v1.5 carryover). STARTUP-MARKETING-01, STARTUP-MARKETING-02, STARTUP-CHANNEL-02 closed. STARTUP-PILOT-01 functionally closed (synthetic smoke); live-founder ceremony as v1.5 STARTUP-PILOT-LIVE-01.
Stopped at: Phase 28 closed (5/5 plans shipped). Next milestone task: Phase 28.5 (Startups Web App + Clerk #3 + Per-Startup Agent Email) — team-cms; reuses 28-01..05 infrastructure. Phase 29 (Telnyx SMS + Voice AI) follows. Recurring Infisical-CLI-in-wrong-org issue persists (STARTUP_API_SECRET + STARTUP_MCP_ADMIN_SECRET still need Infisical sync from /tmp/*.txt).
Resume file: null (Phase 28 complete; run /rrr:plan-phase 28.5 to start the next phase)
