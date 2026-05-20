---
phase: 19-todo-auto-resolution
plan: 01
subsystem: parrot-worker
tags: ["cron", "durable-object", "graph-api", "auto-clear", "v1.3"]
requires: ["18"]
provides: ["19-01"]
affects: ["19-02", "19-03"]
tech-stack:
  added: []
  patterns:
    - "DO RPC stub.method() called from cron-triggered worker module"
    - "Fail-soft per-item loop with structured JSON logs"
    - "Cypher minimum-open-window guard (datetime() - duration({minutes: N}))"
key-files:
  created:
    - apps/parrot/workers/lib/auto-clear.ts
  modified:
    - apps/parrot/workers/durableObject/migrations.ts
    - apps/parrot/workers/durableObject/index.ts
    - apps/parrot/wrangler.jsonc
    - apps/parrot/workers/app.ts
decisions:
  - "Migration 8 adds resolution_source TEXT (no DEFAULT) — preserves NULL semantics for legacy rows"
  - "5-minute grace period in Cypher prevents new-todo flash-and-disappear (PITFALL-AC-01)"
  - "getResolvedTodos() DO method co-located here despite belonging to Plan 02 — single cohesive DO change"
metrics:
  duration: "~25 min"
  completed: "2026-05-19"
---

# Phase 19 Plan 01: Auto-Clear Backend Spine Summary

DO migration 8 (`resolution_source TEXT`) + `resolveTodo`/`unresolveTodo`/`getResolvedTodos` RPCs on `EmployeeMailboxDO`, plus a CF Worker Cron Trigger (`*/5 * * * *`) and the new `workers/lib/auto-clear.ts` module that reconciles closed `:Todo` nodes from the Phase 18 graph proxy.

## What Shipped

- **Migration 8** (`8_resolution_source`): single `ALTER TABLE todos ADD COLUMN resolution_source TEXT` with CHECK constraint. 8 migrations total in `employeeMailboxMigrations`. Verified `grep -c 8_resolution_source` returns 1; total entries = 8.
- **DO RPCs** (3 methods on `EmployeeMailboxDO`):
  - `resolveTodo(sourceId)` — `UPDATE ... SET resolved_at=now(), resolution_source='agent' WHERE source_id=? AND resolved_at IS NULL`. Idempotent. Returns `{ resolved: boolean }`.
  - `unresolveTodo(todoId)` — `UPDATE ... SET resolved_at=NULL, resolution_source=NULL WHERE id=? AND resolution_source='agent'`. Refuses to undo user-resolved (NULL) or active rows. Returns `{ unresolved: boolean }`.
  - `getResolvedTodos()` — last-48h resolved rows ordered by `resolved_at DESC`, LIMIT 100. Includes `resolution_source` in the SELECT for the UI's Agent vs You pill.
- **Cron trigger** in `wrangler.jsonc`: `"triggers": { "crons": ["*/5 * * * *"] }`. 5-minute interval chosen per PITFALL-AC-03.
- **`scheduled` handler** in `app.ts`: `ctx.waitUntil(runAutoClear(env))`. Pre-existing `fetch` + `email` handlers preserved.
- **`workers/lib/auto-clear.ts`**: `runAutoClear(env)` posts the grace-period Cypher to `GRAPH_API_URL/query` with Bearer auth, parses both array-row and named-column FalkorDB response shapes, fans out `stub.resolveTodo(source_id)` per match. Fully fail-soft on missing env, fetch error, non-2xx, malformed JSON, and per-item DO RPC failures.

## Decisions Made

- **Migration 8 has no DEFAULT.** Existing resolved rows (from `cleanupTodosForEmail`) stay NULL, which the UI interprets as `'user'` for the "You" pill. The new agent path writes `'agent'` explicitly. This avoids a bulk UPDATE on migration apply and keeps the semantic "legacy = user-resolved" implicit.
- **`getResolvedTodos` co-located in this plan.** It's officially Plan 19-02's DO method but adding it here keeps `EmployeeMailboxDO` changes in one commit and lets Plan 02 focus on the HTTP route surface. Documented as a deviation in EXECUTION-REPORT.
- **Grace period inside the Cypher, not in the DO.** Putting `valid_to < datetime() - duration({minutes: 5})` at the query layer means the cron simply doesn't see un-grace-period candidates — no second filter needed in TypeScript. Cleaner separation of concerns.
- **rowsWritten access pattern.** Drains the `SqlStorageCursor` with `for (const _row of cursor) void _row;` before reading `cursor.rowsWritten` — required by the CF DO SQL API for the counter to be populated.

## Verification Results

```
grep -c "8_resolution_source" migrations.ts → 1
grep "async resolveTodo|async unresolveTodo|async getResolvedTodos" index.ts → 3 methods
grep "crons" wrangler.jsonc → "*/5 * * * *"
grep "scheduled|runAutoClear" app.ts → import + handler present
grep "GRAPH_API_URL|GRAPH_API_SECRET" types.ts → declarations present (Phase 18 carry-over)
grep "duration({minutes: 5})" auto-clear.ts → grace period confirmed
Migration count in employeeMailboxMigrations → 8

apps/parrot && npx tsc --noEmit → exit 0 (clean)
wrangler.jsonc JSON parse (comment-stripped) → OK
```

## Files

- Created: `apps/parrot/workers/lib/auto-clear.ts` (158 lines)
- Modified: `apps/parrot/workers/durableObject/migrations.ts` (+30 lines for migration 8 + comments)
- Modified: `apps/parrot/workers/durableObject/index.ts` (+103 lines for 3 RPC methods + JSDoc)
- Modified: `apps/parrot/wrangler.jsonc` (+18 lines for triggers.crons block + comments)
- Modified: `apps/parrot/workers/app.ts` (+19 lines for runAutoClear import + scheduled handler)

## Commit

`6415650 feat(19-01): add migration 8 + cron auto-clear backend`

## Deviations from Plan

- **Added `getResolvedTodos` here instead of Plan 02.** The plan's `files_modified` for 19-01 didn't list this method, but it belongs on the DO and shipping it in one commit keeps the DO change atomic. Documented in EXECUTION-REPORT.
- **`types.ts` not modified.** Plan 19-01 listed it under `files_modified`, but Phase 18 (commit `3449299`) and Phase 20-01 (commit `fd24477`) already added `GRAPH_API_URL` and `GRAPH_API_SECRET` to the `Env` interface — re-adding would cause a duplicate-key TypeScript error. Verified existing declarations via `grep`.

## Authentication Gates

None during execution. Deployment to production requires `wrangler deploy` (HUMAN-ACTION, listed in EXECUTION-REPORT).
