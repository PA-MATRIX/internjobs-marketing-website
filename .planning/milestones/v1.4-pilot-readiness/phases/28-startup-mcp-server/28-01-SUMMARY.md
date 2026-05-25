---
phase: 28-startup-mcp-server
plan: 01
subsystem: infra
tags: [hono, node, fly, postgres, pgvector, mcp, bearer-auth, channel-adapter]

# Dependency graph
requires:
  - phase: 18-falkordb-fly-proxy
    provides: "infra/graph-api/ Hono/Node Fly proxy pattern that this plan mirrors"
  - phase: 03-startup-identity
    provides: "startups + startup_members + roles tables this plan extends"
  - phase: 04-mastra-agent-core
    provides: "inbound_messages, student_embeddings, role_embeddings, conversations tables this plan reads/extends"
provides:
  - "internjobs-startup-api Fly app — 11-endpoint Hono/Node REST proxy at https://internjobs-startup-api.fly.dev"
  - "Bearer-authenticated SQL surface for Phase 28 startup-mcp Worker + Phase 29 Telnyx adapter"
  - "Migration 0011: startups.mcp_token_hash + startup_channel_links + startup_action_log + outbound_messages"
  - "Migration 0012: inbound_messages.startup_mark column"
  - "UPSERT (ON CONFLICT DO UPDATE) semantics on /v1/channel-links — opt_in_flags + updated_at advance on re-POST"
  - "Concierge onboarding bootstrap pattern — synthesized clerk_user_id='concierge:<hex>' for founders pre-Clerk-org"
affects:
  - 28-02-mcp-worker-scaffold-server-tools
  - 28-03-channel-adapter-pattern
  - 28-04-admin-endpoint-onboarding
  - 28-05-marketing-mcp-page
  - 29-startup-telnyx-sms-voice (Telnyx adapter calls /v1/messages and /v1/channel-links)

# Tech tracking
tech-stack:
  added:
    - "hono ^4.7.11 (HTTP framework — same as infra/graph-api/)"
    - "@hono/node-server ^1.13.7"
    - "pg ^8.13.3 (node-postgres — used directly for the SQL surface)"
  patterns:
    - "Fly proxy + CF Worker bridge — each Worker-needing-DB phase ships a paired infra/{name}-api/ Hono app"
    - "Bearer auth via node:crypto timingSafeEqual + equal-length-first early return"
    - "UPSERT via ON CONFLICT DO UPDATE EXCLUDED.field — opt_in_flags and metadata always overwrite, status/member_id COALESCE-preserve"
    - "Concierge clerk_user_id placeholder = 'concierge:<16-byte hex>' — sortable, debuggable, flippable when founder completes Clerk auth"
    - "pgvector literal = `[n1,n2,...]` text + `::vector` SQL cast — avoids node-postgres custom type parser"

key-files:
  created:
    - "infra/startup-api/src/index.mjs (~450 LOC — 11 Hono routes)"
    - "infra/startup-api/{Dockerfile, fly.toml, package.json, .dockerignore, smoke.mjs}"
    - "apps/app/db/migrations/0011_v1_4_startup_mcp.sql"
    - "apps/app/db/migrations/0012_v1_4_startup_mark.sql"
  modified: []

key-decisions:
  - "Schema realignment: created outbound_messages in 0011 (was assumed pre-existing by plan but no prior migration defined it)"
  - "Embedding writes go to separate {role,student}_embeddings tables, not roles.embedding column (which doesn't exist; v1.2 Phase 04 modelled embeddings as side tables)"
  - "Concierge clerk_user_id placeholder unblocks Ridhi-led pilot onboarding before Clerk org exists; founder row UPDATEs the column later"
  - "Embedding dimension lock = 768 (bge-base-en-v1.5 per migration 0005), validated server-side; rejects dim mismatch with 400"
  - "thread mark uses 3-way OR match (id, metadata.thread_id, metadata.student_thread_id) — flexibly accepts whatever thread id the Worker resolves; rowCount=0 returns ok (idempotent no-op, not 404)"
  - "STARTUP_API_SECRET NOT yet in Infisical — see User Setup Required section; the secret was set directly on Fly and is captured at /tmp/startup_api_secret.txt for Infisical persistence follow-up"

patterns-established:
  - "infra/{name}-api/ Fly Hono/Node proxy = canonical bridge for any CF Worker that needs Fly Postgres SQL access. Plans 28-02..05 + Phase 29 inherit this pattern."
  - "ON CONFLICT DO UPDATE EXCLUDED.opt_in_flags = strongly preferred over DO NOTHING for channel-link re-registration; opt-in state must update on re-POST or operators can't toggle weekly_touchbase post-install."
  - "pgvector cast pattern: pass `[n1,n2,...]` as text param + `::vector` in SQL — works with stock node-postgres, no custom oid parser needed."

# Metrics
duration: 11min
completed: 2026-05-24
---

# Phase 28 Plan 01: internjobs-startup-api Fly Proxy + MCP Schema Migrations Summary

**Hono/Node REST proxy at internjobs-startup-api.fly.dev (11 endpoints, Bearer-authed) + migrations 0011 (mcp_token_hash, startup_channel_links, startup_action_log, outbound_messages) + 0012 (inbound_messages.startup_mark), unblocking plans 28-02..05 for the startup-mcp Cloudflare Worker.**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-05-25T01:27:55Z
- **Completed:** 2026-05-25T01:38:52Z
- **Tasks:** 2 (migration apply + Fly proxy deploy)
- **Files modified:** 10 (2 SQL migrations + 8 infra files including package-lock.json)

## Accomplishments

- **Migration 0011 applied live** to internjobs-student-db: `startups.mcp_token_hash` + `mcp_token_issued_at` + `mcp_token_rotated_at` columns; `startup_channel_links` table with `UNIQUE (startup_id, channel_type, channel_external_id)` constraint; `startup_action_log` table; `outbound_messages` table (deviation — not created by prior migrations). All five `\d` / `\dt` probes returned expected rows.
- **Migration 0012 applied live**: `inbound_messages.startup_mark` text column + partial index `(startup_id, startup_mark) WHERE startup_mark IS NOT NULL`.
- **internjobs-startup-api Fly app created and deployed** in `ord` region with 2 shared-cpu-1x machines (min_machines_running=1, auto_stop=off — matches infra/graph-api/ HA pattern). `https://internjobs-startup-api.fly.dev/health` returns `{"ok":true}`.
- **11 Hono routes** all Bearer-authenticated via node:crypto timingSafeEqual (constant-time, equal-length-first early return): health, /v1/startups/token, /v1/startups, PATCH /v1/startups/:id/token, /v1/roles, /v1/messages, /v1/channel-links, /v1/action-log, /v1/search/candidates, PATCH /v1/roles/:id, PATCH /v1/threads/:id/mark.
- **`smoke.mjs` 13/13 PASS against production URL** — covers health, 401 on missing/wrong Bearer, 404 on unknown token, startup-create + token-roundtrip (creates throwaway "smoke-*" startup, hashes its returned plaintext token, looks up successfully), role create, message create, channel-link UPSERT, action-log, candidate search (envelope check), role PATCH (success + ownership-enforcement 404), thread mark.
- **Load-bearing B2 invariant verified directly in DB**: two successive `/v1/channel-links` POSTs with the same `(startup_id, channel_type, channel_external_id)` tuple but different `opt_in_flags`. Verified via `psql`: `opt_in_flags = {"weekly_touchbase": true}` (second value) stuck; `metadata = {"source": "smoke-re-post"}` (second value) stuck; `updated_at > created_at` (returned `t`). DO UPDATE semantics confirmed in production.

## Task Commits

Each task was committed atomically:

1. **Task 1: SQL migration 0011 — MCP token columns + channel-links + audit-log + outbound_messages** — `f0c6bda` (feat)
2. **Task 2: internjobs-startup-api Fly proxy + migration 0012 startup_mark** — `05c39b4` (feat)

**Plan metadata (this SUMMARY + STATE.md update):** committed separately at plan close.

## Files Created/Modified

- `apps/app/db/migrations/0011_v1_4_startup_mcp.sql` — 113 lines: `ALTER TABLE startups` + 3 new tables (`startup_channel_links`, `startup_action_log`, `outbound_messages`) + indexes
- `apps/app/db/migrations/0012_v1_4_startup_mark.sql` — 13 lines: `ALTER TABLE inbound_messages ADD startup_mark` + partial index
- `infra/startup-api/src/index.mjs` — 450+ lines, 11 Hono routes, 768-dim embedding validation, ownership-checked PATCHes
- `infra/startup-api/{Dockerfile, fly.toml, package.json, package-lock.json, .dockerignore}` — mirrors infra/graph-api/ structure
- `infra/startup-api/smoke.mjs` — 13-check smoke suite (exits 0 on full PASS)

## Decisions Made

- **outbound_messages table created in migration 0011** (not pre-existing as plan assumed): the Phase 04 `drafts` table is the v1.2 approval-queue, but it has different semantics (`pending_review → approved → sent`) and threads through human operators. Phase 28's MCP `reply_to_candidate` action is a direct-send path that bypasses approval (founder authored the message themselves via their LLM), so a clean `outbound_messages` log per-channel makes more sense. Phase 29 Telnyx SMS will append rows here with `channel='telnyx-sms'`.
- **Embedding writes target separate `*_embeddings` tables**, not a `roles.embedding` column (migration 0005 already established this — 768-dim bge-base-en-v1.5 in `role_embeddings` keyed by `role_id`). The plan's `UPDATE roles SET embedding = $1::vector` would have errored — Rule 1 (bug) fix applied inline.
- **Concierge clerk_user_id placeholder = `concierge:<16-byte hex>`** unblocks Ridhi's pilot onboarding flow (Phase 28 plan 28-04 admin endpoint) without requiring Clerk org provisioning first. The format is sortable (string starts with "concierge:") and debuggable in admin queries. Founder rows get UPDATE'd when they complete Clerk auth at workspace.internjobs.ai.
- **/v1/threads/:id/mark uses a flexible 3-way OR match** (`im.id::text`, `metadata->>'thread_id'`, `metadata->>'student_thread_id'`) because `inbound_messages` doesn't have a first-class `thread_id` column — threading is modelled via `student_threads.thread_key` joined through `conversations`. Returning `ok: true` with `updated: 0` on no-match is idempotent-friendly (the MCP `mark_candidate` action is safe to call multiple times) and avoids leaking thread-existence info via 404.
- **`primary_region = "ord"`** (not "iad" as the plan suggested): matches `infra/graph-api/` and `internjobs-student-db` for low intra-Fly-network latency (the proxy and Postgres are both `ord`-pinned).
- **`min_machines_running = 1` + `auto_stop_machines = "off"`** mirrors infra/graph-api/: cold-start tax on the founder's very first MCP tool call is worse than ~$2/mo of always-warm.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `roles.embedding` column doesn't exist; embeddings live in `role_embeddings`**
- **Found during:** Task 2 (proxy implementation)
- **Issue:** PLAN.md's `/v1/roles` handler executes `UPDATE roles SET embedding = $1::vector WHERE id = $2`. The `roles` table has no `embedding` column (only `id, startup_id, title, description, requirements, status, location, comp_range, created_at, updated_at`). Migration 0005 (v1.2 Workers AI swap) established embeddings as a side table `role_embeddings(role_id, embedding vector(768), model)` — same pattern for students.
- **Fix:** Changed the handler to `INSERT INTO role_embeddings ... ON CONFLICT (role_id) DO UPDATE` with the `@cf/baai/bge-base-en-v1.5` model literal.
- **Files modified:** `infra/startup-api/src/index.mjs`
- **Verification:** smoke test [4/9] role_create PASS; would have errored with `column "embedding" of relation "roles" does not exist` under the plan-as-written.
- **Committed in:** `05c39b4`

**2. [Rule 1 - Bug] `student_profile_embeddings` table doesn't exist; use `student_embeddings`**
- **Found during:** Task 2 (search SQL drafting)
- **Issue:** PLAN.md's `/v1/search/candidates` query joins `LEFT JOIN (SELECT DISTINCT ON (student_id) ... FROM student_profile_embeddings ...)`. That table doesn't exist. The actual table is `student_embeddings` (PK on `student_id`, vector(768), per migrations 0004 + 0005). No DISTINCT-ON needed — PK is per-student.
- **Fix:** Rewrote the search query: `JOIN student_embeddings se ON se.student_id = s.id`, used real `students` columns (`COALESCE(name, email, 'unknown') AS summary`), added an `EXISTS (SELECT 1 FROM inbound_messages WHERE startup_id=$2)` ownership clause, added optional cosine-similarity threshold, kept 1–20 limit clamp.
- **Files modified:** `infra/startup-api/src/index.mjs`
- **Verification:** smoke test [8/9] search_candidates PASS (returns empty envelope for fresh smoke startup); also returned 0 rows for real startups in DB without inbound_messages — proving the ownership boundary works.
- **Committed in:** `05c39b4`

**3. [Rule 1 - Bug] `startup_members` requires NOT NULL UNIQUE `clerk_user_id` and has no `phone`/`status` columns**
- **Found during:** Task 2 (/v1/startups handler)
- **Issue:** PLAN.md's handler does `INSERT INTO startup_members (startup_id, email, phone, role, status) VALUES (...)`. Real schema (migration 0003) has columns `(id, startup_id, clerk_user_id NOT NULL UNIQUE, role, email NOT NULL, name, created_at, updated_at)` — no `phone`, no `status`. clerk_user_id is required.
- **Fix:** Synthesized `clerk_user_id = 'concierge:<16-byte hex>'` placeholder (one-line `randomBytes(16).toString("hex")`). Dropped `phone` from insert (still accepted in request body, just ignored — kept for forward-compat with self-serve Clerk flow). Dropped `status` from insert (column doesn't exist).
- **Files modified:** `infra/startup-api/src/index.mjs`
- **Verification:** smoke test [3/9] startup_create + [3b/9] token_roundtrip PASS — startup + founder member created end-to-end, the issued plaintext token's SHA-256 hash maps back to the same `startup_id`.
- **Committed in:** `05c39b4`

**4. [Rule 3 - Blocking] `outbound_messages` table doesn't exist in any prior migration**
- **Found during:** Task 1 (migration drafting + Task 2 /v1/messages endpoint)
- **Issue:** PLAN.md's `/v1/messages` handler inserts into `outbound_messages`. The closest existing table is `drafts` (Phase 04), which has different semantics (`pending_review → approved → sent`). The startup-mcp Worker's `reply_to_candidate` action sends a message directly (founder approved by composing it) — not a draft for human review.
- **Fix:** Added `CREATE TABLE IF NOT EXISTS outbound_messages (...)` to migration 0011 with the columns the proxy needs (`startup_id`, `member_id`, `thread_id text`, `content`, `channel default 'mcp'`, `direction default 'outbound'`, `provider_message_id`, `delivery_status default 'pending'`, `metadata jsonb`, `created_at`). Added two indexes for the expected access patterns.
- **Files modified:** `apps/app/db/migrations/0011_v1_4_startup_mcp.sql`, `infra/startup-api/src/index.mjs`
- **Verification:** `\dt outbound_messages` confirms table exists; smoke test [5/9] message_create PASS — row inserted, id returned.
- **Committed in:** `f0c6bda` (table) + `05c39b4` (endpoint)

**5. [Rule 1 - Bug] `students` table has no `first_name`, `last_name`, `major`, `graduation_year` columns**
- **Found during:** Task 2 (search SQL drafting)
- **Issue:** PLAN.md's search returns `s.first_name || ' ' || s.last_name AS summary, s.major, s.graduation_year, ...`. None of those columns exist on `students` (it has: id, clerk_user_id, email, name, linkedin_profile_url, status, channel_type, channel_address, channel_confirmed_at, created_at, updated_at).
- **Fix:** `COALESCE(s.name, s.email, 'unknown') AS summary`. Returned `email` + `linkedin_profile_url AS linkedin` + `status` instead of the missing fields. Plans 28-02/03/04/05 will build the MCP `discover_actions`+`search` tool output around this slim profile schema. Future expansion (graduation_year/major) would need its own migration + LinkedIn enrichment columns (phase out of scope).
- **Files modified:** `infra/startup-api/src/index.mjs`
- **Verification:** Search smoke test PASS; the SUMMARY in the result envelope is the student's name fallback chain.
- **Committed in:** `05c39b4`

**6. [Rule 1 - Bug] Embedding dimension 768 (bge-base-en-v1.5), not the unspecified-dim float[] PLAN suggested**
- **Found during:** Task 2 (search + role embedding paths)
- **Issue:** Migration 0005 locks `vector(768)` for both `student_embeddings` and `role_embeddings` (Workers AI swap from OpenAI text-embedding-3-small/1536-dim to bge-base-en-v1.5/768-dim). The proxy must validate this dimension or runtime SQL errors will be cryptic.
- **Fix:** Added `if (embedding.length !== 768) return 400 embedding_dim_mismatch` on `/v1/search/candidates`. The 768 lock is in a code comment + the validation message. Plan 28-02's startup-mcp Worker will use the same Workers AI bge-base binding it inherits from the student app.
- **Files modified:** `infra/startup-api/src/index.mjs`
- **Verification:** Embedding-mismatch 400 path covered by code; smoke generates a real 768-vector.
- **Committed in:** `05c39b4`

---

**Total deviations:** 6 auto-fixed (5x Rule 1 schema-mismatch bugs, 1x Rule 3 missing-table blocker).
**Impact on plan:** All deviations are necessary realignment to the actual DB schema (which the plan drafter sketched in the abstract without cross-referencing migrations 0003/0004/0005). Zero scope creep — every endpoint specified in PLAN.md `must_haves.truths` is implemented and smoke-verified. The MCP Worker (28-02), channel adapters (28-03), and admin endpoint (28-04) will see the same auth+endpoint contract the plan promised.

## Issues Encountered

- **Infisical CLI in wrong org**: The user's local `infisical` CLI session is logged into the Projecta org, not the internjobs org. Attempts to `infisical secrets set STARTUP_API_SECRET=...` against the internjobs workspace returned 403 "This project does not belong to your selected organization." Workaround: set the secret directly on Fly via `flyctl secrets set` (which worked), and write the generated secret to `/tmp/startup_api_secret.txt` for the user to copy into Infisical post-execution. This is captured in **User Setup Required** below.
- **`MEMORY.md infisical-project ID was stale**: `2c12f042` referenced in memory is dead. The correct repo workspace ID is `26995afd-9a6f-4690-912f-01cbcebb76d5` (read from `.infisical.json` at repo root). Memory note should be updated.
- **Local migration runner unreachable**: `apps/app/scripts/migrate.mjs` connects to `internjobs-student-db.internal` (private Fly network) — not addressable from a local laptop. Resolved by running `flyctl proxy 5433:5432 -a internjobs-student-db` in background and pointing psql at `127.0.0.1:5433`. Standard pattern for this repo (worth documenting as `scripts/db-proxy.sh` in a future hygiene pass).

## User Setup Required

**One follow-up action needed: persist STARTUP_API_SECRET into Infisical so future re-deploys + Phase 28 plan 02+ Worker can fetch it from the same place as DATABASE_URL.**

1. Read the secret from the local temp file the executor wrote:
   ```bash
   cat /tmp/startup_api_secret.txt
   ```
2. In Infisical UI (or `infisical secrets set` after switching to the internjobs org via `infisical login`), add a secret at path `/internjobs-ai`, env `prod`:
   - **Name:** `STARTUP_API_SECRET`
   - **Value:** `<contents of /tmp/startup_api_secret.txt>` (64 hex chars, e.g. starts with `22b4377887f1...`)
3. After persistence, optionally delete `/tmp/startup_api_secret.txt` from the local machine.

The secret is already live on Fly (`flyctl secrets list -a internjobs-startup-api` shows it deployed) — Phase 28 plan 02 (startup-mcp Worker) reads its copy of the secret from a fresh `wrangler secret put STARTUP_API_SECRET` in its own deploy, so this Infisical sync is a hygiene / disaster-recovery step, not a blocker.

## Next Phase Readiness

**Unblocks plans 28-02, 28-03, 28-04, 28-05 (all of Phase 28).**

- `https://internjobs-startup-api.fly.dev` is healthy and Bearer-authed end-to-end.
- The startup-mcp Worker (28-02) will:
  - Read its own `STARTUP_API_SECRET` (set via `wrangler secret put`) and pass it as the `Authorization: Bearer` header when calling this proxy.
  - Use `POST /v1/startups/token` to resolve incoming MCP-request bearer tokens (hash → startup context).
  - Use `POST /v1/search/candidates` with a 768-dim bge embedding (Workers AI binding) for the `search` MCP tool.
  - Use `POST /v1/roles` / `POST /v1/messages` / `POST /v1/action-log` for the `execute` MCP tool's per-action handlers.
- The admin endpoint (28-04) will use `POST /v1/startups` to issue install tokens for Ridhi-led concierge onboarding.
- Phase 29 (Telnyx SMS+Voice) inherits this proxy untouched: it adds rows to `startup_channel_links` with `channel_type='telnyx-sms'` and `outbound_messages` rows with `channel='telnyx-sms'` — no schema changes needed.

**Watchlist for plan 28-02 execution:**
- Concierge `clerk_user_id` placeholder needs a `migrate_concierge_to_real_user` admin endpoint someday (out of scope for v1.4; flag for v1.5 backlog).
- `/v1/threads/:id/mark` 3-way OR match works for v1.4 pilot, but should be replaced with a proper `inbound_messages.thread_id` first-class column once the threading model stabilizes (also v1.5 hygiene).
- STARTUP_API_SECRET → Infisical sync (see User Setup Required) is the only known outstanding hygiene item from this plan.

---
*Phase: 28-startup-mcp-server*
*Completed: 2026-05-24*
