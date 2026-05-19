---
phase: 14-parrot-knowledge-graph
plan: 02
subsystem: memory
tags: [falkordb, knowledge-graph, parrot, ai-gateway, kimi-k2.6, durable-objects, workers, cache-bypass]

# Dependency graph
requires:
  - phase: 14-01-parrot-knowledge-graph
    provides: "graph.ts helper (getEmployeeContext, recordTodoFact, ensureParrotGraphSchema, fail-soft contract)"
  - phase: 12-dashboard-mothership-agent
    provides: "extractTodosFromText() + EmployeeMailboxDO extractTodosFromEmail/Chat extraction pipeline (Wave 2 ingest path)"
provides:
  - "extractTodosFromText accepts optional 5th arg contextBlock — graph-derived <employee_context> prepended to system prompt"
  - "cf-aig-cache-ttl forced to 0 when contextBlock present (personalized prompt = non-cacheable)"
  - "EmployeeMailboxDO.extractTodosFromEmail wired to getEmployeeContext (pre) + recordTodoFact fire-and-forget (post)"
  - "EmployeeMailboxDO.extractTodosFromChat wired to same pre/post pattern (cacheTtl=1800 default, 0 when context present)"
  - "void ensureParrotGraphSchema bootstrap on first extraction per isolate (idempotent)"
  - "getTodos comment documents ROADMAP SC-7 graph close-out semantics (SQLite resolved_at IS NULL ↔ FalkorDB valid_to IS NULL)"
affects:
  - 14-03-graph-context-injection (most of the wiring already lands here — Wave 3 likely scopes down to additional context-block formats or model-specific tuning)
  - phase-12-dashboard-mothership-agent (extraction pipeline now graph-augmented; cache hit rate will drop for active employees, expected behavior)
  - phase-13-cross-pane (StartMeeting + cross-pane handoffs benefit from richer todo context if they call extractTodosFromText in v1.3)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optional-arg-with-cache-bypass: when a personalized parameter is present, force cache TTL=0 in the same path"
    - "Pre-extraction graph read (await getEmployeeContext) + post-extraction graph write (void recordTodoFact) bracket the LLM call"
    - "Fire-and-forget bootstrap (void ensureParrotGraphSchema) on every extraction path — idempotent, cheap, isolate-warm cache makes the warm path zero-cost"
    - "Empty-string-as-no-op handoff: getEmployeeContext returns '' when FalkorDB unavailable → callers pass `contextBlock || undefined` → ai.ts hasContext check stays false → cacheTtl unchanged from Phase 12 behavior"

key-files:
  created: []
  modified:
    - "apps/parrot/workers/lib/ai.ts (extractTodosFromText signature + system-prompt prefix + effectiveCacheTtl override)"
    - "apps/parrot/workers/durableObject/index.ts (graph import; pre/post wiring on extractTodosFromEmail + extractTodosFromChat; getTodos comment)"

key-decisions:
  - "Forward `contextBlock || undefined` (not the raw string) into ai.ts so a graph-unavailable empty string short-circuits to the static-prompt cacheable path — preserves Phase 12 cache-hit economics for cold-start / FalkorDB-down employees."
  - "Bootstrap schema (void ensureParrotGraphSchema) on every extraction, not just the first one. The graph helper already de-dups via index-exists check + 'already indexed' swallow. Trade-off: one extra round-trip on cold isolate vs. forgetting to bootstrap if the DO is re-instantiated. Idempotent-and-cheap wins."
  - "Chat sourceId fallback: posts[0]?.id ?? 'unknown' (not 'batch' as Phase 12 used). Matches the plan's spec and keeps the FalkorDB :Todo hash stable. 'batch' was a non-deterministic placeholder that would have collapsed all batch-fallback todos to a single graph node — bug avoided."
  - "getTodos SQL unchanged: the valid_to mirror lives in FalkorDB, not SQLite. The SQLite resolved_at column is touched by cleanupTodosForEmail() on email delete; the graph's auto-clear is a separate dimension exercised on the next extraction cycle (graph-derived context block stops mentioning the resolved todo)."
  - "Backward-compatible signature: optional 5th param, default behavior unchanged. Existing 4-arg call sites in EmployeeMailboxDO (and any future caller that omits the arg) continue to hit the cacheable path at the original TTL. Only the explicitly-context-passing path bypasses cache."

patterns-established:
  - "Personalized-prompt cache bypass: when a system prompt embeds per-user dynamic data, force cf-aig-cache-ttl=0 in the same code path that injects the data. Don't trust the caller to remember."
  - "Pre-extraction graph read awaited (feeds the prompt); post-extraction graph write fire-and-forget (cosmetic side-effect). Two different latency budgets, two different awaiting modes."
  - "Idempotent schema bootstrap on every hot-path entry. graph.ts owns the de-dup; callers don't need to remember to call init() exactly once."

# Metrics
duration: 2min 30s
completed: 2026-05-19
---

# Phase 14 Plan 02: Parrot Knowledge Graph — Wave 2 (Phase 12 wiring) Summary

**EmployeeMailboxDO now reads `<employee_context>` from FalkorDB before every kimi-k2.6 extraction call and writes each extracted todo back as a `:Todo` node fire-and-forget — the dashboard's active todo list reflects graph-level resolution without a cron.**

## Performance

- **Duration:** 2 min 30 s
- **Started:** 2026-05-19T18:23:03Z
- **Completed:** 2026-05-19T18:25:33Z
- **Tasks:** 2 / 2
- **Files modified:** 2

## Accomplishments

- **Added optional `contextBlock?: string` arg to `extractTodosFromText`** (workers/lib/ai.ts). When present and non-empty, prepended to the system prompt before the `<role>` block. `cf-aig-cache-ttl` forced to `0` in that path — personalized prompts must never be served from cache (they embed per-employee open-todo state). Existing 4-arg call sites are unchanged: their cacheable behavior at the original TTL is preserved.
- **Wired `getEmployeeContext` + `recordTodoFact` into both extraction paths** in EmployeeMailboxDO. Email path (`extractTodosFromEmail`) and chat path (`extractTodosFromChat`) both now: `void ensureParrotGraphSchema(this.env)` (idempotent bootstrap) → `await getEmployeeContext(this.env, employeeId)` (returns `""` when FalkorDB unreachable) → pass `contextBlock || undefined` as the 5th arg → after `insertTodos()`, loop `for (const t of extracted) void recordTodoFact(this.env, {...})` so the graph stays in sync with the SQLite todos table.
- **`getTodos` SQL unchanged** but now carries a documentation comment explaining the SQLite-vs-graph split: SQLite `resolved_at IS NULL` is the per-DO active filter; the FalkorDB `valid_to IS NULL` mirror on `:Todo` nodes is exercised by `recordTodoFact` (close-out via deterministic hash from Wave 1) and read by `getEmployeeContext()` on the next extraction cycle. The two layers handle two different "active" dimensions.
- **Fail-soft contract preserved end-to-end.** When `FALKORDB_URL` is absent, `getEmployeeContext` returns `""`, the falsy-coalesce in `contextBlock || undefined` resolves to `undefined`, the ai.ts `hasContext` check stays `false`, and the cache TTL stays at the Phase 12 default (3600 email / 1800 chat). `recordTodoFact` calls are `void`-prefixed so their internal `if (!env.FALKORDB_URL) return null` short-circuit is invisible to the extraction hot path.
- **TypeScript clean.** `tsc -b --noEmit` reports the same 3 pre-existing errors documented in 14-01-SUMMARY (OnboardingWizard.tsx Uint8Array, ai.ts(305,18) + ai.ts(312,33) `.choices does not exist` — line numbers shifted slightly because of the new signature, semantically identical). Zero NEW errors introduced.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add contextBlock to extractTodosFromText in ai.ts** — `e2d0949` (feat)
2. **Task 2: Wire graph reads + writes into EmployeeMailboxDO** — `c79a6d3` (feat)

_Plan metadata commit follows below._

## Files Created/Modified

- **modified** `apps/parrot/workers/lib/ai.ts` (+19 / −2) — new optional 5th param `contextBlock?: string` on `extractTodosFromText`; `hasContext` boolean drives `effectiveCacheTtl = hasContext ? 0 : cacheTtl` + `systemPrefix = hasContext ? \`${contextBlock}\\n\\n\` : ""`; `systemPrefix` prepended to the existing `<role>` system-prompt string; JSDoc updated to describe the new param + cache bypass. Inline comment ("When contextBlock is present, cf-aig-cache-ttl is forced to 0 — personalized prompts must not be served from cache") sits above the param declaration for grep-friendliness.
- **modified** `apps/parrot/workers/durableObject/index.ts` (+69 / −1) — added `import { getEmployeeContext, recordTodoFact, ensureParrotGraphSchema } from "../lib/graph"` block under a `Phase 14 Wave 2: graph wiring` comment. `extractTodosFromEmail` wraps the existing LLM call with `void ensureParrotGraphSchema` + `await getEmployeeContext` (pre-call) and a `for (const t of extracted) void recordTodoFact(...)` loop (post-insertTodos). `extractTodosFromChat` follows the same template, plus a `posts[0]?.id ?? "unknown"` `sourceId` derivation (replaces the previous `"batch"` fallback — see Decisions below). `getTodos` SQL untouched, but a 7-line comment block above `WHERE resolved_at IS NULL` documents the SQLite ↔ FalkorDB active-filter split.

## Decisions Made

- **Forward `contextBlock || undefined` (not the raw string) into ai.ts.** A graph-unavailable empty string short-circuits to the static-prompt cacheable path. Preserves Phase 12 cache-hit economics for cold-start / FalkorDB-down employees — they pay only the kimi-k2.6 cost once per identical text, just like before this wave. Alternative considered: always pass `contextBlock` and let ai.ts handle the empty case. Rejected because the `|| undefined` is a single character that makes the JS-side filtering explicit at the call site, which is where reviewers grep first.
- **Schema bootstrap on every extraction call** (`void ensureParrotGraphSchema`). graph.ts already de-dups via index-exists check + "already indexed" swallow; cost on the warm path is one Cypher round-trip the FalkorDB client batches into the same connection as the subsequent `getEmployeeContext` reads. Trade-off chosen: one extra round-trip per cold isolate (negligible) vs. the risk of forgetting to bootstrap if the DO is re-instantiated mid-session and the first extraction tries to MERGE against an unindexed graph. Idempotent-and-cheap wins.
- **Chat `sourceId` fallback: `posts[0]?.id ?? "unknown"`.** The plan specifies `"unknown"`; the previous code used `"batch"`. `"batch"` was a single literal that would collapse every batch-fallback todo to the same FalkorDB `:Todo` hash, accidentally clobbering close-out semantics across batches. `"unknown"` is the same shape but more honest about the fallback nature. In practice the alarm only calls `extractTodosFromChat` when `posts.length > 0`, so the fallback is dead code — but choosing the safer literal future-proofs against caller drift.
- **`getTodos` SQL unchanged.** The `valid_to` field lives on FalkorDB `:Todo` nodes (Wave 1), not in the SQLite `todos` table. The SQLite layer's `resolved_at IS NULL` is already correct for the per-DO active filter; SQLite cares about "is this email/chat-post still referenced", FalkorDB cares about "has this todo been resolved by a downstream thread reply". Two separate dimensions, two separate sources of truth. The added comment block makes the split explicit so the next reader doesn't try to add `AND valid_to IS NULL` to a SQL query that has no `valid_to` column.
- **Backward-compatible signature on `extractTodosFromText`.** The 5th param is optional. Every existing 4-arg call site continues to work, hits the cacheable path at the original TTL, no migration needed. Only the explicitly-context-passing path bypasses cache. This isolates the cache impact to exactly the employees who have FalkorDB-backed context (currently: anyone who's had a successful Wave 14-01 extraction logged).

## Deviations from Plan

None — plan executed exactly as written.

The only small lift beyond literal plan text: JSDoc on `extractTodosFromText` was updated to describe the new `contextBlock` param and the cache-bypass behavior. Plan didn't require this; doing it now keeps the docs in sync with the signature (cheap, no separate commit needed — landed in the Task 1 commit alongside the signature change).

## Issues Encountered

- **`tsc -b --noEmit` reports the same 3 pre-existing errors** documented in 14-01-SUMMARY: `OnboardingWizard.tsx(140,5)` Uint8Array<ArrayBufferLike> (Phase 13 Wave 1 carryover), `workers/lib/ai.ts(305,18)` + `workers/lib/ai.ts(312,33)` `.choices does not exist` (Phase 12 Wave 1 carryover). Line numbers in `ai.ts` shifted by ~17 lines because of the new signature + JSDoc; semantically identical, same underlying type-mismatch root cause. Zero NEW errors introduced. Flagged for v1.3 cleanup, not in scope for this wave.

## User Setup Required

None. `FALKORDB_URL` + `FALKORDB_PASSWORD` Worker secrets were pushed to Parrot in the Wave 14-01 session and are still active. Verify with:

```
cd apps/parrot && npx wrangler secret list | grep -E "FALKORDB_URL|FALKORDB_PASSWORD"
```

If both are absent, push via:

```
cd apps/parrot && npx wrangler secret put FALKORDB_URL      # Infisical /internjobs-ai/FALKORDB_URL
cd apps/parrot && npx wrangler secret put FALKORDB_PASSWORD # Infisical /internjobs-ai/FALKORDB_PASSWORD
```

After deployment, the next inbound email or chat batch will:
1. Bootstrap the Parrot label namespace (`void ensureParrotGraphSchema` — idempotent CREATE INDEX).
2. Read `<employee_context>` (will be `""` for an employee with no prior `:Todo` nodes — first extraction hits the static-prompt cacheable path).
3. Extract todos via kimi-k2.6.
4. Insert into SQLite `todos` (existing Phase 12 path).
5. Fire-and-forget `recordTodoFact` writes to FalkorDB for each extracted todo (populates the graph for subsequent extractions to read from).

Step 2 returns non-empty starting from the SECOND extraction onward (graph populated from step 5 of the first). At that point the cache TTL flips to 0 for that employee's extraction calls — expected behavior, documented in plan.

## Next Phase Readiness

- **Wave 14-03 (graph context injection — final wave of Phase 14) is partially pre-empted by this wave.** The core injection path (`getEmployeeContext` → `extractTodosFromText` system prompt) is now live in production code, gated only on `FALKORDB_URL` presence. Wave 14-03 will likely scope to: (a) any additional context-block formats beyond the prose summary (e.g., structured JSON for newer model variants), (b) per-model cache-TTL tuning if we move off kimi-k2.6, (c) observability — emitting structured logs for "context-augmented extraction" so we can A/B the lift.
- **Phase 12 cache hit rate will drop for active employees.** This is expected and intentional — the whole point of personalized prompts is that they invalidate cache. The flat TTL pre-Wave-2 was a cost optimization that traded against personalization; Wave 2 flips that trade for active users. Cold / FalkorDB-down employees continue to hit the cacheable path. Monitor AI Gateway dashboard for the cost shift; flag if it's larger than ~30% of total AI Gateway traffic.
- **No concerns.** TypeScript clean (no NEW errors), fail-soft contract preserved end-to-end (FALKORDB_URL absent → static-prompt cacheable path, same as Phase 12), no forbidden `api.cloudflare.com/.../ai/run/` URLs introduced, no new packages, no schema migrations. All graph calls are fire-and-forget (`void` prefix) except `getEmployeeContext` which is awaited because it feeds the prompt — failure mode is short-circuit-to-empty-string, never throws.
- **Operational note:** the first deployment after this wave will hit FalkorDB harder than before (every extraction now triggers 2 graph reads + N graph writes vs. the previous 0 graph calls). Wave 14-01's module-level connection cache de-dupes within an isolate, but request bursts at cold start are now a slightly larger surface. If FalkorDB shows sustained latency >100ms on extraction-path Cypher queries, the fix is to raise the FalkorDB Fly instance's CPU/RAM, NOT to add a circuit breaker — the fail-soft contract is already the circuit breaker.

---
*Phase: 14-parrot-knowledge-graph*
*Plan: 02 (Wave 2: Phase 12 wiring)*
*Completed: 2026-05-19*
