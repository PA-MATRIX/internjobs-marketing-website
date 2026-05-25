---
schema_version: 2
milestone: "v1.4"
phase: 28
phase_name: "Startup MCP Server + Channel-Adapter Core"
phase_total: 8
plan: 1
plan_total: 5
status: "in_progress"
progress: 6
last_activity: "2026-05-24"
session_last: "2026-05-24"
resume_file: ".planning/milestones/v1.4-pilot-readiness/phases/28-startup-mcp-server/28-02-PLAN.md"
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
Phase: 28 of 29 (Startup MCP Server + Channel-Adapter Core — team-cms) — **IN PROGRESS (1/5 plans complete)**
Plan: 28-01 complete (internjobs-startup-api Fly proxy deployed + migrations 0011/0012 applied); 28-02..05 unblocked
Status: 28-01 deployed and smoke-verified end-to-end (13/13 PASS in prod); ready to execute 28-02 (startup-mcp Cloudflare Worker scaffold)
Last activity: 2026-05-24 — 28-01 executed: Hono/Node Fly proxy at internjobs-startup-api.fly.dev with 11 Bearer-authed endpoints; migrations 0011 (mcp_token_hash + startup_channel_links + startup_action_log + outbound_messages) + 0012 (inbound_messages.startup_mark) applied live to internjobs-student-db; B2 UPSERT invariant verified in prod (re-POST /v1/channel-links → opt_in_flags + updated_at both advance). 6 deviations all auto-fixed (5x Rule 1 schema-mismatch bugs realigning to actual DB; 1x Rule 3 missing outbound_messages table created in 0011). 2 atomic commits + this metadata commit.

Progress: ███░░░░░░░ 9% (6/68 requirements done; STARTUP-MCP-01..02 + STARTUP-CHANNEL-01 closed by 28-01; BRAND-VERIFY-01/02/03 closed by 22-05; 17 brand-layout/logo/copy reqs by 22-04; 8 brand foundation reqs by 22-03; LAKERA-V2-01/02/03 by 22-01; SAFETY-VERIFY-LIVE-01/02 by 22-02 — -03 deferred to v1.5)

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
| 28 | 1 | 5 | ~11 min (28-01: ~11 min) |

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

### Pending Todos

- **Persist STARTUP_API_SECRET to Infisical** — value at `/tmp/startup_api_secret.txt`, target path `/internjobs-ai/STARTUP_API_SECRET` env `prod` workspace `26995afd-9a6f-4690-912f-01cbcebb76d5`. Will require `infisical login` against the internjobs org first.
- **Update MEMORY.md infisical-project.md** — replace stale workspace ID `2c12f042...` with correct `26995afd-9a6f-4690-912f-01cbcebb76d5` (the value in repo `.infisical.json`).
- Execute 28-02 (startup-mcp Cloudflare Worker scaffold + 4 MCP tools)
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

Last session: 2026-05-24 — 28-01 (internjobs-startup-api Fly proxy + migrations 0011/0012) complete. Hono/Node REST proxy at `https://internjobs-startup-api.fly.dev` deployed in `ord` (2 shared-cpu-1x machines, min_machines_running=1, auto_stop=off). 11 endpoints, all Bearer-authed via node:crypto timingSafeEqual: GET /health, POST /v1/startups/token, POST /v1/startups, PATCH /v1/startups/:id/token, POST /v1/roles, POST /v1/messages, POST /v1/channel-links (UPSERT DO UPDATE), POST /v1/action-log, POST /v1/search/candidates (768-dim bge embeddings), PATCH /v1/roles/:id (ownership-checked), PATCH /v1/threads/:id/mark (3-way OR match). Migration 0011 added 3 columns to startups (mcp_token_hash + 2 timestamps), 3 tables (startup_channel_links, startup_action_log, outbound_messages — last is a deviation, not pre-existing), 6 indexes. Migration 0012 added inbound_messages.startup_mark + partial index. Smoke suite 13/13 PASS against prod URL. Load-bearing B2 UPSERT invariant verified directly in DB: two POST /v1/channel-links with same key tuple + different opt_in_flags → second value sticks and updated_at advances (psql probe returned opt_in_flags=true + metadata="re-post" + updated_advanced=t). 6 deviations all auto-fixed under Rule 1 (5x schema-mismatch bugs) + Rule 3 (1x missing outbound_messages table). 2 atomic task commits (f0c6bda migration, 05c39b4 proxy) + this metadata commit. STARTUP_API_SECRET live on Fly; Infisical sync flagged as user-setup follow-up (CLI in wrong org).
Stopped at: 28-01 complete. Plans 28-02..05 all unblocked — the proxy + schema is the load-bearing dependency for the startup-mcp Cloudflare Worker (28-02), channel-adapter pattern (28-03), admin/onboarding endpoint (28-04), and marketing MCP install page (28-05).
Resume file: `.planning/milestones/v1.4-pilot-readiness/phases/28-startup-mcp-server/28-02-PLAN.md`
