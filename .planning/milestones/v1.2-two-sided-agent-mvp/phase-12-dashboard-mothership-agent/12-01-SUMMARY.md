---
phase: 12-dashboard-mothership-agent
plan: 01
subsystem: infra
tags: [cloudflare, ai-gateway, durable-objects, workers-ai, kimi-k2, react-router, lucide-icons, drizzle, sqlite]

# Dependency graph
requires:
  - phase: 10
    provides: "EmployeeMailboxDO (per-employee Durable Object), WorkspaceShell.tsx (Slack-style dual-rail), React Router routes config"
provides:
  - "todos table (Migration 3_todos_table) on EmployeeMailboxDO with all columns + indexes from the research spec"
  - "Drizzle `todos` table mirror in workers/db/schema.ts"
  - "callAiGateway() + extractTodosFromText() + TODO_EXTRACTION_SCHEMA in workers/lib/ai.ts — routes Workers AI calls through Cloudflare AI Gateway with per-employee user_id metadata + prompt cache TTL"
  - "GET /api/dashboard/todos Hono route returning { todos: [] } via DO RPC (stub returns empty until Wave 2)"
  - "Phone (lucide Phone, /phone) and SMS (lucide MessageCircle, /sms) entries in WorkspaceShell NAV icon rail"
  - "/phone and /sms route stubs with future-architecture comments + 'Coming soon — Telnyx via Cloudflare Agents SDK' UI"
  - "routes.ts registration for /phone and /sms — without this Wave-1 wiring step React Router would 404 the icon-rail clicks"
  - "Env extensions: CLOUDFLARE_AI_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, PARROT_AI_GATEWAY_ID, KIMI_MODEL, MATTERMOST_BOT_TOKEN?, PARROT_DEV_MODE?"
  - "wrangler.jsonc: KIMI_MODEL=@cf/moonshotai/kimi-k2.6 var + secret declarations as inline comments"
affects: [12-02, 12-03, "v1.3 telephony", "v1.3 Cognee/Telnyx integration"]

# Tech tracking
tech-stack:
  added: ["Cloudflare AI Gateway (transport, no npm dep)", "@cf/moonshotai/kimi-k2.6 model id"]
  patterns:
    - "LLM calls via Cloudflare AI Gateway (cf-aig-metadata.user_id + cf-aig-cache-ttl)"
    - "Per-employee LLM quota enforcement at gateway layer, not in code"
    - "Fail-soft AI helper (returns [] on missing config / 429 / non-2xx) — extraction never blocks email storage"
    - "JSON-schema response_format with kimi-k2.6 for structured extraction"
    - "Seam-not-integration nav (Phone/SMS) — icon + placeholder route, no telephony backend"

key-files:
  created:
    - "apps/parrot/app/routes/phone.tsx"
    - "apps/parrot/app/routes/sms.tsx"
  modified:
    - "apps/parrot/workers/durableObject/migrations.ts"
    - "apps/parrot/workers/durableObject/index.ts"
    - "apps/parrot/workers/db/schema.ts"
    - "apps/parrot/workers/types.ts"
    - "apps/parrot/workers/index.ts"
    - "apps/parrot/workers/lib/ai.ts"
    - "apps/parrot/wrangler.jsonc"
    - "apps/parrot/app/components/WorkspaceShell.tsx"
    - "apps/parrot/app/routes/dashboard.tsx"
    - "apps/parrot/app/routes.ts"

key-decisions:
  - "Use Cloudflare AI Gateway for Parrot LLM calls (NOT direct Workers AI REST). Rationale: per-employee daily quota + prompt cache. Student app at apps/app/ keeps direct REST — single shared Maya agent identity has no per-user quota concept."
  - "kimi-k2.6 is the Phase-12 model; KIMI_MODEL env var lets us A/B a fallback (llama-3.3-70b-instruct-fp8-fast) without code changes."
  - "Wave-1 ai.ts exports extractTodosFromText() but does NOT call it. Wave 2 wires the call sites (createEmail() for email path, DO alarm for chat path)."
  - "EmployeeMailboxDO.getTodos(view) is a stub returning [] in Wave 1; the API contract is locked so React UI can ship final-state code before Wave 2 lands ingest."

patterns-established:
  - "AI Gateway transport: POST gateway.ai.cloudflare.com/v1/{accountId}/{gatewayId}/workers-ai/{model} with Authorization Bearer + cf-aig-metadata + cf-aig-cache-ttl"
  - "DO RPC stub-first: ship the method signature + empty return so the Hono route + React UI can be coded in the same wave, then fill the implementation in the next wave without contract changes"
  - "Seam routes: nav icon + route registration + placeholder UI + inline source comment with future implementation. No npm packages installed."

# Metrics
duration: 6m 23s
completed: 2026-05-19
---

# Phase 12 Plan 1: Dashboard Mothership Agent Foundation Summary

**todos table on EmployeeMailboxDO + Cloudflare AI Gateway helper (cf-aig-metadata per-employee quota) + GET /api/dashboard/todos + Phone/SMS seam routes — zero-ambiguity scaffold for Wave 2 ingest.**

## Performance

- **Duration:** 6m 23s
- **Started:** 2026-05-19T05:01:39Z
- **Completed:** 2026-05-19T05:08:02Z
- **Tasks:** 3
- **Files modified:** 10 (8 modified + 2 created)
- **Commits:** 3 atomic task commits

## Accomplishments

- **Cross-channel todo storage in place.** Migration `3_todos_table` is applied when EmployeeMailboxDO boots. Columns (id, employee_id, source_channel ∈ {email,chat,phone,sms,meeting}, source_id, title, preview, urgency_score, deadline_at, mentioned_actors, is_mention, created_at, resolved_at) + indexes (`idx_todos_urgency`, `idx_todos_source`) match the research spec exactly. Drizzle mirror in `workers/db/schema.ts` for ORM writes.
- **Cloudflare AI Gateway helper shipped.** `workers/lib/ai.ts` exports `callAiGateway(messages, clerkUserId, cacheTtl, env)` and `extractTodosFromText(...)` — both route through `gateway.ai.cloudflare.com/v1/{accountId}/{gatewayId}/workers-ai/{model}` with `cf-aig-metadata.user_id` (per-employee quota) and `cf-aig-cache-ttl` (prompt cache). Fail-soft: returns `[]` on missing config, 429 quota, or any non-2xx. Inline comment explains why Parrot uses gateway while student app uses direct REST (locked decision per ROADMAP.md line 209). `Skills referenced:` comment block names `cloudflare/skills: agents-sdk, durable-objects, cloudflare`.
- **Dashboard API endpoint live.** `GET /api/dashboard/todos` is registered on the Hono app, protected by `requireEmployeeMailbox`, parses `?view=all|mentions|today|week` query param, calls `stub.getTodos(view)` (Wave-1 stub returns `[]`), and responds `{ todos: [] }`.
- **Phone + SMS icon-rail seams.** `WorkspaceShell.tsx` NAV array adds Phone (lucide `Phone`) and SMS (lucide `MessageCircle`) between Meetings and the operator-only admin section. Both routes are registered in `app/routes.ts` and render a "Coming soon — Telnyx via Cloudflare Agents SDK" card with inline source comments documenting the future `withVoice(Agent)` + `@cloudflare/voice-twilio` direction.
- **Dashboard pane secondary nav wired to query params.** All-todos / Mentions / Today / This week now navigate to `?view=` query params via `useSearchParams`, so when Wave 2 lands the ingest pipeline the loader can read `view` and filter accordingly without a UI change.
- **Zero new npm packages.** No `@cloudflare/voice`, no `agents`, no `@cloudflare/voice-twilio`, no `@telnyx/voice-cloudflare`, no Daily.co — verified by `grep package.json`.
- **TypeScript compiles clean** (`npx tsc --noEmit` returns zero errors).

## Task Commits

Each task was committed atomically:

1. **Task 1: todos migration + Drizzle schema + Env types + wrangler bindings** — `5fe02a9` (feat)
2. **Task 2: AI Gateway helper + GET /api/dashboard/todos + Phone/SMS nav icons + new route stubs** — `7ef33cc` (feat)
3. **Task 3: routes.ts registration for /phone and /sms** — `e4e2ed4` (feat)

## Files Created/Modified

**Created:**
- `apps/parrot/app/routes/phone.tsx` — Placeholder route with future `@cloudflare/voice` + `withVoice(Agent)` + `@cloudflare/voice-twilio` architecture comments (no imports — pure comment seam).
- `apps/parrot/app/routes/sms.tsx` — Same pattern, lucide `MessageCircle` icon, SMS-flavored future-implementation comment block.

**Modified:**
- `apps/parrot/workers/durableObject/migrations.ts` — Appended `3_todos_table` migration to `employeeMailboxMigrations` array.
- `apps/parrot/workers/durableObject/index.ts` — Added `getTodos(view): Promise<unknown[]>` stub returning `[]` to `EmployeeMailboxDO`. Wave 2 replaces this with real ranking SQL.
- `apps/parrot/workers/db/schema.ts` — Added Drizzle `todos` table mirroring the migration column shape.
- `apps/parrot/workers/types.ts` — Added 6 keys to `Env` (CLOUDFLARE_AI_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, PARROT_AI_GATEWAY_ID, KIMI_MODEL, MATTERMOST_BOT_TOKEN?, PARROT_DEV_MODE?) + matching entries in the `CfEnvBase` `Omit` tuple so wrangler-generated literal types don't collide.
- `apps/parrot/workers/index.ts` — Registered `GET /api/dashboard/todos` Hono route.
- `apps/parrot/workers/lib/ai.ts` — Rewrote from Phase-10 stub to real `callAiGateway()` + `extractTodosFromText()` + `TODO_EXTRACTION_SCHEMA` + `ExtractedTodo` interface. Kept the legacy `DraftAssistNotImplementedError` + `suggestReply()` exports for any callers still referencing them.
- `apps/parrot/wrangler.jsonc` — Added `"KIMI_MODEL": "@cf/moonshotai/kimi-k2.6"` to `vars`; added secret declarations as inline comments (`CLOUDFLARE_AI_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PARROT_AI_GATEWAY_ID`, `MATTERMOST_BOT_TOKEN`).
- `apps/parrot/app/components/WorkspaceShell.tsx` — Imported `Phone` + `MessageCircle` from lucide-react; added Phone + SMS to the `NAV` array between Meetings and the admin section.
- `apps/parrot/app/routes/dashboard.tsx` — Secondary-nav views now use `useSearchParams` and link to `?view=mentions|today|week`; "Wave 4" placeholder card relabeled "Phase 12" reflecting the wave split done in Phase-10 closure.
- `apps/parrot/app/routes.ts` — Registered `route("phone", "routes/phone.tsx")` + `route("sms", "routes/sms.tsx")`.

## Decisions Made

- **AI Gateway transport over direct REST** for Parrot — locked by ROADMAP.md line 209. Per-employee daily caps are configurable in the CF Dashboard via `cf-aig-metadata.user_id`; prompt caching reduces cost on identical email/chat windows.
- **kimi-k2.6 as Phase-12 model** — pinned via `KIMI_MODEL` env var so we can A/B fall back to `llama-3.3-70b-instruct-fp8-fast` (no `response_format` JSON-schema support, but cheaper) without code changes.
- **Wave-1 stub-first DO RPC** — `getTodos(view)` returns `[]` so the Hono route + React UI can ship final-state code in this wave; Wave 2 fills the implementation without changing the contract.
- **Skills referenced comment** — added in `workers/lib/ai.ts` per the planner agreement (`cloudflare/skills: agents-sdk, durable-objects, cloudflare`); the executor agent will auto-load these when Wave 2 wires the real call sites.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] routes config file path correction**
- **Found during:** Task 3 (routes.ts registration for /phone and /sms)
- **Issue:** Plan frontmatter listed the routes config as `apps/parrot/app/routes/routes.ts`, but the actual React Router framework config lives at `apps/parrot/app/routes.ts` (`apps/parrot/app/routes/` is the directory holding route module files like `dashboard.tsx`, `inbox.tsx`, etc.).
- **Fix:** Edited `apps/parrot/app/routes.ts` (the real config file). The plan task description anticipated this ("may be `app/routes.ts` or `app/router.tsx` depending on the project layout") so this is path resolution, not a contract change.
- **Files modified:** `apps/parrot/app/routes.ts`
- **Verification:** `grep -E '"phone"|"sms"' apps/parrot/app/routes.ts` shows both registrations; `npx tsc --noEmit` clean.
- **Committed in:** `e4e2ed4`

**2. [Rule 3 — Blocking] EmployeeMailboxDO.getTodos stub added (not in frontmatter)**
- **Found during:** Task 2 (the Hono route calls `stub.getTodos(view)`, but no such method existed on the DO class)
- **Issue:** Task 2 of the plan instructs to "add a stub `getTodos(view: string): Promise<unknown[]>` method to `EmployeeMailboxDO` in `durableObject/index.ts`" but the plan's `files_modified` frontmatter does NOT list `apps/parrot/workers/durableObject/index.ts`. Without the stub, the route call would fail at compile/runtime.
- **Fix:** Added the stub method (returns `[]`) at the bottom of the class. Documented its role + Wave-2 replacement intent in a comment block. Plan task body and DO file modification are both in the same commit.
- **Files modified:** `apps/parrot/workers/durableObject/index.ts`
- **Verification:** `grep -n "getTodos" apps/parrot/workers/durableObject/index.ts` returns line 430; `npx tsc --noEmit` clean.
- **Committed in:** `7ef33cc`

---

**Total deviations:** 2 auto-fixed (both Rule 3 — Blocking, both anticipated by the plan task bodies even though the frontmatter file list was a hair behind).
**Impact on plan:** No scope creep. Both deviations are path/file corrections explicitly called for in the task action text — frontmatter `files_modified` drift only.

## Issues Encountered

- **`npm run build` and `wrangler deploy --dry-run` both fail with pre-existing environment errors** (`Cannot find package 'vite'` from the workspace root, plus the React Router virtual server-build module not resolving when wrangler is invoked standalone). Verified pre-existing by stashing the plan's changes and re-running — the failure reproduces on `main` without this plan's commits. NOT a regression. The plan's hard verification gate is `npx tsc --noEmit` which passes clean across all three task commits.

## User Setup Required

**External service: Cloudflare AI Gateway provisioning** — see plan frontmatter `pre_execution_user_actions`. The plan-author flagged this as a user pre-action; Wave 2 cannot make real LLM calls until the user:

1. Logs in to `dash.cloudflare.com` → Account → AI → AI Gateway → Create.
2. Names the gateway `internjobs-parrot` (or similar; the slug becomes `PARROT_AI_GATEWAY_ID`).
3. Configures per-user daily limit: 200 requests/day/employee.
4. Runs `wrangler secret put PARROT_AI_GATEWAY_ID` on the `internjobs-parrot` Worker with that slug, plus `wrangler secret put CLOUDFLARE_AI_API_TOKEN` and `wrangler secret put CLOUDFLARE_ACCOUNT_ID` (value `0fffd3dc637bdb26d4963df445a69fd3` from Infisical).

Wave 1 does not call the gateway, so this user action is non-blocking for the current plan but BLOCKS Wave 2 from going live.

## Next Phase Readiness

**Ready for Wave 2 (12-02):** All the storage, transport, and UI scaffolding Wave 2 needs is in place. Wave 2 can implement:
- `extractTodosFromEmail()` calling `extractTodosFromText()` at the `createEmail()` choke-point in `EmployeeMailboxDO`.
- `pollMattermostNewPosts()` + `alarm()` self-rescheduling every 2 minutes on the same DO.
- Replace the `getTodos(view): Promise<unknown[]>` stub with the real ranking SQL `ORDER BY` query (formula already documented in `12-RESEARCH.md`).

Wave 2 does NOT need to touch:
- The migration file (todos schema is final for this milestone).
- `wrangler.jsonc` (KIMI_MODEL var + secret declarations are complete).
- `workers/types.ts` Env interface (all six new keys land here).
- `app/routes.ts` (Phone + SMS already wired).
- `WorkspaceShell.tsx` (icon rail is final for Phase 12).

**Blockers/concerns:**
- User must create the CF AI Gateway and set the three Worker secrets before Wave 2 production deploy can make live LLM calls. Wave 2 dev work can proceed with the env vars unset — `callAiGateway()` already fails soft to `[]`.
- The Mattermost bot account + `MATTERMOST_BOT_TOKEN` is a separate Wave-2 user action (also flagged in the plan).

---

*Phase: 12-dashboard-mothership-agent*
*Plan: 01*
*Completed: 2026-05-19*
