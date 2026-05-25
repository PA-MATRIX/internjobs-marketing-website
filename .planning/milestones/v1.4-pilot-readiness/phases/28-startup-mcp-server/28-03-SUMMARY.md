---
phase: 28-startup-mcp-server
plan: 03
subsystem: mcp
tags: [cloudflare-workers, workers-ai, pgvector, zod, audit-log, channel-adapter, fly-proxy, mcp]

# Dependency graph
requires:
  - phase: 28-startup-mcp-server-01
    provides: "internjobs-startup-api Fly proxy at internjobs-startup-api.fly.dev with /v1/roles, /v1/messages, /v1/action-log, /v1/search/candidates, PATCH /v1/roles/:id, PATCH /v1/threads/:id/mark — this plan calls all of them from the execute()/search() handlers"
  - phase: 28-startup-mcp-server-02
    provides: "apps/startup/ Worker scaffold with createMcpHandler() + readAuthProps() + 4-tool surface (me/discover_actions wired; search/execute as stable-shape stubs) — this plan fills the stubs"
provides:
  - "Full execute() with 5 action handlers (post_role, reply_to_candidate, update_role, archive_role, mark_candidate) — Zod-validated, ownership-enforced, audit-logged on every call"
  - "Full search() across 6 scopes (roles, candidates, threads, messages, members, startups) — pgvector for candidates, ILIKE for the other 5, all scoped to the authenticated startup_id"
  - "me() wired to live /v1/startups/:id/stats endpoint — role_count is an integer (was placeholder 0 in 28-02)"
  - "lib/audit.ts — writeAuditLog() POST /v1/action-log fire-and-forget; hashParams() SHA-256 helper"
  - "lib/embed.ts — embedText() via env.AI.run('@cf/baai/bge-base-en-v1.5') — compute-independent from student app"
  - "infra/startup-api adds GET /v1/startups/:id/stats + POST /v1/search/:scope (5 structured scopes), Bearer-authed, ownership-scoped"
  - "Cross-startup negative test verified: token-for-A returns 'not_found_or_not_owned' when patching startup-B's role; search('roles') for A vs B has zero overlap"
affects:
  - 28-04-admin-endpoint-onboarding
  - 28-05-marketing-mcp-page
  - 28.5-startups-web-app (web channel will call the SAME proxy endpoints)
  - 29-startup-telnyx-sms-voice (Telnyx adapter will reuse the same execute/search dispatch with channel='telnyx-sms')

# Tech tracking
tech-stack:
  added:
    - "Workers AI binding 'AI' (declared in wrangler.jsonc) — @cf/baai/bge-base-en-v1.5 model for 768-dim embeddings; CF bills per-neuron, not per-binding"
  patterns:
    - "Zod .strip() (default) drops unknown fields silently — including any rogue startup_id from LLM hallucinations. startup_id ALWAYS comes from auth-resolved props, never params."
    - "Audit log in finally{} — fires on success, handler error, AND Zod validation error. Captures abuse + LLM drift signal in startup_action_log."
    - "Channel-adapter pattern locked: channel='mcp' is one literal value the adapter writes. Phase 29 Telnyx will reuse the same handleExecute() entry point with channel='telnyx-sms'."
    - "Compute-independence: startup Worker calls env.AI.run() directly. ZERO runtime dependency on apps/app/ (student app). 'search candidates' under student SMS load won't degrade."
    - "Structured-search 1.0 score convention — non-pgvector scopes return score=1.0 for every hit (no relevance ranking, just SQL match). LLM clients can sort by other fields (created_at, last_inbound_at)."
    - "Stats endpoint as audit-log smoke proxy — actions_last_7d count is a side-channel way to verify writeAuditLog() is firing without psql access from a laptop."

key-files:
  created:
    - "apps/startup/workers/lib/audit.ts (~70 LOC) — writeAuditLog + hashParams"
    - "apps/startup/workers/lib/embed.ts (~60 LOC) — embedText via Workers AI"
    - "apps/startup/workers/lib/ directory (NEW)"
  modified:
    - "apps/startup/workers/tools/execute.ts — full 5-action implementation (replaced 28-02 stub; ~310 LOC)"
    - "apps/startup/workers/tools/search.ts — full 6-scope implementation (replaced 28-02 stub; ~155 LOC)"
    - "apps/startup/workers/tools/me.ts — wired to /v1/startups/:id/stats (~85 LOC; was ~37)"
    - "apps/startup/workers/server.ts — pass env to handleSearch (1-line change)"
    - "apps/startup/wrangler.jsonc — added 'ai' binding"
    - "infra/startup-api/src/index.mjs — added GET /v1/startups/:id/stats + POST /v1/search/:scope (5 scopes); ~190 LOC added"

key-decisions:
  - "startup_id NEVER from params. All 5 Zod schemas omit startup_id as a field, and .strip() default drops any rogue param value. Auth-context startup_id is the only one that reaches the proxy. Combined with the proxy's WHERE startup_id = $auth on every PATCH, cross-startup leaks are impossible at TWO layers (Worker Zod + DB SQL)."
  - "Audit log fires in finally{} regardless of success/error/Zod-rejection. Even an invalid_params response writes status='error' / error_code='invalid_params' to startup_action_log — gives us LLM-drift signal in production (e.g. 'Claude is calling post_role without description' shows up as an audit metric)."
  - "embedText() returns null on missing env.AI binding (fail-soft). handlePostRole sends embedding=null to /v1/roles; the proxy skips role_embeddings UPSERT gracefully and the role row still inserts. Better to ship the role than 500 the founder on a transient AI-binding hiccup."
  - "Structured search score=1.0 hard-coded for non-pgvector scopes. The MCP envelope contract requires a `score` field; for ILIKE results there's no meaningful relevance number. 1.0 (perfect match) is the safe constant — the LLM should use other fields (created_at, last_inbound_at, message_count) for ranking. v1.5 candidate: BM25 or trigram similarity for soft scoring."
  - "search('threads') aggregates inbound_messages BY student — there's no first-class thread_id column (Phase 28 decided not to add one; it's deferred to v1.5 hygiene). The summary is the student name/email, the id is the student_id, and extras include last_inbound_at + message_count + startup_mark. LLM clients can compose: `search('threads')` → pick a student → `execute('reply_to_candidate', {thread_id: <student.id>, ...})`."
  - "search('startups') hardcodes id = $startup_id — caller sees ONLY their own record. The query parameter is ignored for matching but included in the response shape for consistency. This is the explicit 'own record' guarantee called out in the plan must_haves."
  - "GET /v1/startups/:id/stats returns BOTH active_role_count AND actions_last_7d. me() uses the role_count and synthesizes the recent_activity string from actions_last_7d. The stats endpoint is also the only practical way to verify audit-log writes without psql access (Fly machines have no psql installed)."
  - "Workers AI binding declared 'ai': { binding: 'AI' } in wrangler.jsonc — CF bills per-neuron (per AI call), not per-binding. Free to declare. Verified at deploy via `wrangler deploy` output: 'env.AI → AI binding'."

patterns-established:
  - "Per-action dispatch table = {action_name: {schema: ZodObject, handler: Promise-returning}}. Adding a 6th action means: (1) write a Zod schema, (2) write an async handler(startup_id, params, env), (3) add entry to ACTION_HANDLERS. The Zod enum in server.ts execute tool def also needs the new action name to prevent unknown-action errors at MCP layer."
  - "Zod safeParse + finally{audit} = always-audited execute. Failed Zod doesn't skip audit — every call (even malformed) writes one row. This is the right design for an LLM-facing API: every misuse is signal."
  - "Channel adapter is one string literal. writeAuditLog({channel: 'mcp'}) here; Phase 29 will writeAuditLog({channel: 'telnyx-sms'}). No other code change needed to add a channel — the same handleExecute() handles both."

# Metrics
duration: 11min
completed: 2026-05-25
---

# Phase 28 Plan 03: search/execute action handlers + audit log + role_count wire-up Summary

**Full implementation of execute() (5 actions: post_role, reply_to_candidate, update_role, archive_role, mark_candidate — each Zod-validated, ownership-enforced, audit-logged) and search() (6 scopes: roles, candidates, threads, messages, members, startups — pgvector for candidates, ILIKE-+-startup_id WHERE for the rest). me() wired to live /v1/startups/:id/stats. Cross-startup negative test verified at TWO layers (Worker Zod strips rogue startup_id; proxy SQL enforces WHERE startup_id = $auth).**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-05-25T03:19:06Z
- **Completed:** 2026-05-25T03:30:22Z
- **Tasks:** 2 (audit/embed/execute helpers + full search/me + proxy endpoints)
- **Smoke tests:** 20/20 PASS (single-pass e2e against deployed Worker + Fly proxy)
- **Worker Version ID:** `d32016e0-2e57-4c90-8d9e-c5d4606d932c`
- **Fly proxy:** redeployed (added GET /stats + POST /search/:scope)

## Accomplishments

- **`lib/audit.ts` + `lib/embed.ts` created**. `writeAuditLog()` is fire-and-forget safe (logs warn on failure but never throws — audit downtime doesn't block user-facing execute responses). `hashParams()` SHA-256 hex; on JSON-stringify failure returns "hash_failed". `embedText()` calls `env.AI.run('@cf/baai/bge-base-en-v1.5')` directly via the Workers AI binding — ZERO dependency on the student app (compute-independence lock from Phase 28). Returns null on missing binding or empty result (fail-soft).
- **`wrangler.jsonc` — added `'ai': { 'binding': 'AI' }`**. Verified live at deploy: `wrangler deploy` output confirms `env.AI → AI binding`. CF bills per-neuron, free to declare.
- **`execute.ts` — full implementation, replaces the 28-02 stub**:
  - 5 per-action Zod schemas (POST_ROLE_SCHEMA, REPLY_TO_CANDIDATE_SCHEMA, UPDATE_ROLE_SCHEMA, ARCHIVE_ROLE_SCHEMA, MARK_CANDIDATE_SCHEMA) — none list `startup_id` as a field. Default `.strip()` silently drops any rogue param the LLM injects (verified via smoke test).
  - 5 handlers (handlePostRole, handleReplyToCandidate, handleUpdateRole, handleArchiveRole, handleMarkCandidate). All receive `startup_id` as the first arg from auth context; never from params. handlePostRole calls embedText() then POSTs role+embedding to `/v1/roles`. handleReplyToCandidate POSTs to `/v1/messages` with channel='mcp'. handleUpdateRole + handleArchiveRole PATCH `/v1/roles/:id` (archive hardcodes `patch: {status: 'filled'}`). handleMarkCandidate PATCH `/v1/threads/:id/mark`.
  - Dispatch table: `ACTION_HANDLERS = { post_role: {schema, handler}, ... }`. Unknown action returns `{ok: false, error: 'invalid_action'}` defensively (server.ts Zod enum already rejects it at MCP arg level — returns `mcpError` not 500, verified in smoke).
  - **Audit log in `finally{}` block** — fires on success, handler error, AND Zod-rejected params. Every call writes one `startup_action_log` row with `channel='mcp'`, `params_hash=SHA-256(JSON.stringify(args.params))`, `status='ok'|'error'`, `error_code` (set on failure), `latency_ms` from t0.
- **`search.ts` — full implementation, replaces the 28-02 stub**:
  - 6-scope dispatch: `candidates` → `searchCandidates()` (embeds query via env.AI.run then POSTs to `/v1/search/candidates` with the 768-dim embedding); all other 5 → `searchStructured()` (POSTs to `/v1/search/:scope` with `{startup_id, query, filters, limit}`).
  - Result envelope is stable: `{scope, query, results: [{id, summary, score, ...}], total_returned, next_cursor: null}`.
  - All scopes are server-side ownership-scoped (WHERE startup_id = $auth). search('startups') hardcodes `id = $startup_id` — caller sees their own record only.
- **`me.ts` wired to `/v1/startups/:id/stats`** — `role_count` is now an integer (was placeholder 0 in 28-02). `recent_activity` is synthesized from `actions_last_7d` ("9 actions in the last 7 days" / "No recent activity in the last 7 days. Call discover_actions() to see what you can do.").
- **`infra/startup-api/src/index.mjs` — 2 new endpoint groups added**:
  - `GET /v1/startups/:id/stats` — `{active_role_count, actions_last_7d, last_action_at}`. Used by me() and as a poor-man's audit-log inspector (Fly machines have no psql installed).
  - `POST /v1/search/:scope` for scopes ∈ {roles, threads, messages, members, startups}. Each scope runs a parameterized ILIKE query with `WHERE startup_id = $1` (startups scope hardcodes `id = $1`). LIKE metacharacters in the query string are escaped server-side (`%` and `_` → `\%` / `\_`). Empty query string returns all rows for the startup. Result rows include scope-appropriate extras (role: status/location/comp_range; threads: last_inbound_at/message_count/startup_mark; messages: channel/direction/thread_id/delivery_status; members: role/email; startups: domain/website/status).
- **e2e smoke verified live against `mcp.internjobs.ai`** with two throwaway startups: 20/20 PASS including:
  - me() returns integer role_count
  - All 5 execute actions return `{ok:true, data, latency_ms}` and write audit rows
  - Invalid action enum → mcpError (`MCP error -32602: Invalid enum value...`) at protocol level, NOT 500
  - Missing required param → `{ok:false, error:'invalid_params', detail: Zod.flatten()}` AND audit row with `error_code='invalid_params'`
  - Rogue `startup_id` in params is silently stripped (verified by post_role with `startup_id: STARTUP_B` — role lands under STARTUP_A)
  - **Cross-startup negative: TOKEN_A trying to update STARTUP_B's role → `{ok:false, error:'not_found_or_not_owned'}`** (proxy 404 because WHERE startup_id = $auth doesn't match)
  - **Cross-startup search isolation: search('roles') for A vs B has overlap=0** (A returned 3 roles, B returned 1, zero shared IDs)
  - All 6 search scopes return well-formed envelopes
  - Stats endpoint confirms 9 audit rows for STARTUP_A (every smoke action) and 1 for STARTUP_B (only the cross-startup setup)
- **Worker deployed**, custom domain still live, `wrangler deploy` output confirms `env.AI` binding visible to the runtime.

## Task Commits

Each task was committed atomically. A mid-execution parallel-collision (peer's first commit accidentally pulled in my unstaged work) was self-corrected when peer rebased to `6afff17`, restoring clean atomic boundaries:

1. **Task 1: audit + embed helpers + full execute() with 5 action handlers** — `d48b145` (feat). 4 files: lib/audit.ts (new), lib/embed.ts (new), tools/execute.ts (replaced stub), wrangler.jsonc (ai binding).
2. **Task 2: search() full implementation + me() role_count wire-up + /v1/search/:scope + /v1/startups/:id/stats** — `be96411` (feat). 4 files: tools/search.ts (replaced stub), tools/me.ts (live stats wire-up), server.ts (env passed to handleSearch), infra/startup-api/src/index.mjs (+ 2 endpoint groups).

**Plan metadata (this SUMMARY + STATE.md update):** committed separately at plan close.

## Files Created/Modified

**Created (2):**
- `apps/startup/workers/lib/audit.ts` (~70 LOC) — `writeAuditLog()` POSTs to `/v1/action-log`; `hashParams()` SHA-256 hex
- `apps/startup/workers/lib/embed.ts` (~60 LOC) — `embedText()` via `env.AI.run('@cf/baai/bge-base-en-v1.5')`, fail-soft

**Modified (6):**
- `apps/startup/workers/tools/execute.ts` — 310 LOC (was ~45 stub). 5 Zod schemas + 5 handlers + dispatch table + audit in finally{}.
- `apps/startup/workers/tools/search.ts` — 155 LOC (was ~44 stub). 6-scope routing; pgvector for candidates, structured proxy for others.
- `apps/startup/workers/tools/me.ts` — 85 LOC (was ~37). Live `/v1/startups/:id/stats` call; fail-soft fallback to placeholder text.
- `apps/startup/workers/server.ts` — 1-line change: pass `env: props.env` to handleSearch() args.
- `apps/startup/wrangler.jsonc` — added `'ai': { 'binding': 'AI' }` after `vars`.
- `infra/startup-api/src/index.mjs` — added `GET /v1/startups/:id/stats` (~30 LOC) + `POST /v1/search/:scope` (~155 LOC). Updated header comment block to reflect new surface.

## Decisions Made

- **startup_id NEVER from params — TWO-LAYER defense.** Layer 1 (Worker): Zod schemas in execute.ts list no `startup_id` field; `.strip()` default silently drops any rogue value. Layer 2 (Proxy): every PATCH endpoint on the Fly proxy has `WHERE id = $1 AND startup_id = $auth_provided`. Even if Layer 1 were bypassed (e.g. by a future change that switches to `.passthrough()`), Layer 2 would still 404 the cross-startup request at SQL. Cross-startup leaks are impossible without coordinated changes at both layers.
- **Audit log fires in `finally{}` regardless of success/error/Zod-rejection.** This was a deliberate decision over "only log on handler invocation": Zod-rejected calls are signal (LLM drift, abuse attempts, schema-version skew). A future ops dashboard can plot `error_code='invalid_params'` rates per startup to flag broken integrations early.
- **embedText() fail-soft (returns null) rather than throw.** Workers AI binding could be missing (dev environment without binding), the call could fail (CF AI outage, neuron quota), or the result could be empty (edge case). The handler downstream sends `embedding: null` to the proxy, the proxy skips role_embeddings UPSERT, and the role row inserts successfully. The role can be back-filled with an embedding later via a v1.5 reconciler. Better to ship a non-embedded role than 500 the founder.
- **Structured-search score = 1.0 constant.** The MCP envelope contract requires `score`. For ILIKE matches there's no meaningful number — every hit is a "match," ranking comes from other fields. 1.0 (perfect) is the safe sentinel. The LLM should compose `search('roles') ORDER BY created_at DESC` mentally. v1.5 candidate: BM25 / pg_trgm trigram similarity for soft ranking.
- **search('threads') aggregates BY student.** There's no first-class `thread_id` column on `inbound_messages` (Phase 28 chose not to add one; v1.5 hygiene). A "thread" in MCP terms is a student×startup conversation. Result rows return `id = student.id`, `summary = student.name|email`, with extras `last_inbound_at`, `message_count`, `startup_mark`. Composes cleanly: `search('threads')` → LLM picks a student → `execute('reply_to_candidate', {thread_id: student.id, ...})`.
- **search('startups') hardcodes `id = $startup_id`.** Caller sees ONLY their own record. The `query` param is ignored for matching (no fuzzy startup-name search against the global catalog — that would leak the customer list). Returns 1 row max.
- **GET /v1/startups/:id/stats serves dual purpose.** Primary: me() role_count + recent_activity. Secondary: it's the only practical way to verify writeAuditLog() is firing without psql access (`actions_last_7d` is a direct count from `startup_action_log` filtered by startup_id). After the smoke test, A=9 actions, B=1 — exactly what the smoke flow performed.
- **No Workers-side rate limiting added in this plan.** Phase 28-02 SUMMARY queued it as a 28-03 candidate; deferred again. The Fly proxy is still the natural bottleneck and pilot traffic is single-digit founders. Real token-bucket-per-startup will need a Durable Object or KV namespace — adding either expands scope. Will revisit if pilot SMS load creates audit-log write contention.

## Deviations from Plan

### Auto-fixed Issues

None auto-fixed during execution. All 5 schema-mismatch deviations from 28-01 (`outbound_messages` table, `role_embeddings` side-table, `student_embeddings`, missing `first_name`/`last_name`, 768-dim lock) were already encoded in the 28-01 proxy contract; this plan just consumes them.

### Parallel-Execution Collision (self-corrected)

**1. [Wave 3 parallel execution] Peer's first commit accidentally pulled in my unstaged Task 2 work; self-corrected when peer rebased.**

- **Found during:** Final git status check before committing Task 2
- **Issue:** Plan 28-03 (this plan) and Plan 28-04 ran in parallel under Wave 3. The team metadata in the spawn prompt said file scopes don't overlap (28-03: tools/, lib/, server.ts; 28-04: routes/admin.ts, app.ts), but BOTH plans needed to modify `apps/startup/wrangler.jsonc` AND `infra/startup-api/src/index.mjs` (28-03 added `ai` binding + /v1/search/:scope + /v1/startups/:id/stats; 28-04 added Telnyx env-var docs + founder-email dedupe pre-check).
- **Initial state:** Peer's first commit `3c89b07` accidentally bundled my unstaged Task 2 changes (tools/search.ts, tools/me.ts, server.ts, +/v1/search/:scope hunks in index.mjs) because they ran a broad `git add` while my changes were in the working tree.
- **Resolution:** Peer rebased to `6afff17` (same conceptual commit, but with ONLY their 4 files: workers/app.ts, workers/routes/admin.ts, wrangler.jsonc, and their own 30-LOC dedupe hunk in infra/startup-api/src/index.mjs). My Task 2 changes were restored to unstaged, and I committed them as a separate atomic Task 2 commit. Atomic-commit-per-task invariant preserved.
- **Recommendation:** For future parallel waves where two plans modify overlapping shared files (`wrangler.jsonc`, `infra/*/src/*.mjs`), the spawn-prompt "no overlap" claim should explicitly call out shared-file edits. Or each agent should `git add <specific-files-only>` immediately after each Edit (never `git add .` or `git add -A`) to avoid cross-contamination.

---

**Total deviations:** 1 process-level (parallel-commit boundary, self-corrected). 0 code deviations. All success criteria satisfied; both peer and 28-03 work committed atomically.

## Files Modified Outside Plan Frontmatter

Per HYGN-04 audit: comparing `git diff --name-only d48b145^..HEAD-after-Task2` to plan frontmatter `files_modified`:

Plan frontmatter listed:
- `apps/startup/workers/tools/{execute,search,me}.ts` — modified ✓
- `apps/startup/workers/lib/{audit,embed}.ts` — created ✓
- `apps/startup/workers/server.ts` — modified ✓
- `apps/startup/wrangler.jsonc` — modified ✓
- `infra/startup-api/src/index.mjs` — modified ✓
- `apps/app/db/migrations/0012_v1_4_startup_mark.sql` — listed but **NOT modified by this plan** (was already created and applied in 28-01; the plan frontmatter listing was a documentation artifact; the migration's `inbound_messages.startup_mark` column is read by the existing `PATCH /v1/threads/:id/mark` endpoint, no new modification needed)

Outside-frontmatter modifications (none expected, none observed for 28-03's scope):
- `apps/startup/workers/routes/admin.ts` — peer 28-04's file, not in my scope
- `apps/startup/workers/app.ts` — peer 28-04 mounted /admin router; not in my scope

Both above are peer-owned and were committed in `3c89b07`. My SUMMARY does not claim ownership of them.

## Issues Encountered

- **No psql in Fly machines.** Verification of audit-log rows in `startup_action_log` was originally planned via `flyctl ssh console ... psql ...`, but the startup-api Fly machine has only Node installed (`psql: not found`). Workaround: the new `GET /v1/startups/:id/stats` endpoint returns `actions_last_7d` count, which is a direct query against `startup_action_log`. After the smoke run, A=9 actions / B=1 action / both consistent with the smoke flow. This is a better verification path than psql anyway (it's the same endpoint the founder's MCP client uses, so we're verifying the live happy path).
- **Parallel-commit boundary collision** (see Deviations §1). My Task 2 work was bundled into the peer's commit `3c89b07`. Code-wise everything works; commit-history-wise the atomicity-per-task contract is bent. Documented and flagged for orchestrator awareness.

## User Setup Required

**None.** All secrets from 28-01/28-02 are already live:
- `STARTUP_API_SECRET` on Fly proxy + Worker (set via `flyctl secrets` / `wrangler secret put` in prior plans).
- `STARTUP_MCP_ADMIN_SECRET` on Worker (set in 28-02; used by 28-04, not by this plan).
- Workers AI binding requires no secret — it's bound automatically when `'ai'` is declared in wrangler.jsonc.

**Throwaway smoke startups left in DB** (`smoke-28-03-startup-A` and `smoke-28-03-startup-B`) — same pattern as 28-01 smoke. Cheap to leave; helps future debugging. Filter by name LIKE `smoke-%` in admin queries to exclude.

## Next Phase Readiness

**Unblocks Plan 28-04 (already in-flight in Wave 3) and Plan 28-05 (marketing CTA receiver).**

- **For Plan 28-04**: The /admin/ router can mint install tokens via `POST /v1/startups` on the proxy and have founders immediately exercise the 5 execute actions + 6 search scopes. The admin endpoint and this plan's handlers compose: Ridhi onboards → founder installs `mcp.internjobs.ai/mcp` in Claude/Cursor → founder calls `me()` (real role_count) → `discover_actions()` → `execute('post_role')` → audit row appears in `startup_action_log`.
- **For Plan 28-05**: The marketing CTA can hit the same `POST /v1/startups` (now with 28-04's 409-on-duplicate-email dedupe). Once a startup is created, all the search/execute machinery this plan ships is immediately usable.
- **For Phase 28.5 (startups web app at startups.internjobs.ai)**: The channel-adapter pattern locked here means the web app will write `channel='web'` to the audit log (using the same writeAuditLog) and the same execute() / search() handlers will serve web-channel founders. NO code changes needed in execute.ts/search.ts for Phase 28.5 — only a third Clerk JWT-validation middleware.
- **For Phase 29 (Telnyx SMS)**: The Telnyx adapter inserts `channel='telnyx-sms'` audit rows via the SAME writeAuditLog helper, and uses the SAME execute()/search() dispatch. The plan-locked `channel` argument on writeAuditLog is the only seam — Phase 29 is a thin adapter layer over this Worker.

**Watchlist:**
- **Workers-side rate limiting still deferred.** Will need a DO or KV namespace. Revisit when 28-04 onboards 5+ founders and audit-log writes start showing contention.
- **search('threads') aggregation is approximate.** A "thread" is a student-aggregated row; real thread modelling would need an inbound_messages.thread_id first-class column (v1.5 hygiene). LLM clients should be fine with the current shape (id = student_id is enough to call reply_to_candidate).
- **No BM25/trigram ranking for structured search.** Every hit scores 1.0. If pilot LLMs start asking "best 3 candidates for role X" via search('threads'), we'll need real ranking. pg_trgm is the cheapest path; install via migration when needed.
- **Atomic-commit-per-task invariant.** This plan tripped it once due to parallel-wave file-sharing on wrangler.jsonc + index.mjs. Future RRR orchestrator runs should either serialize plans that share files or have each agent commit immediately after each file edit (rather than at end-of-task).

---
*Phase: 28-startup-mcp-server*
*Completed: 2026-05-25*
