---
phase: 19-todo-auto-resolution
plan: 02
subsystem: parrot-worker
tags: ["http-routes", "smoke-test", "graph-api", "auto-clear", "v1.3"]
requires: ["19-01"]
provides: ["19-02"]
affects: ["19-03"]
tech-stack:
  added: []
  patterns:
    - "fail-soft graph proxy mutation in HTTP route (Undo)"
    - "smoke test invariant with seeded fixture + finally-block cleanup"
key-files:
  modified:
    - apps/parrot/workers/index.ts
    - infra/graph-api/smoke.mjs
decisions:
  - "Undo returns ok:true even when graph proxy is unreachable — UX trumps consistency"
  - "Smoke test extends infra/graph-api/smoke.mjs (Phase 18 runner) instead of the legacy apps/parrot/scripts/smoke-parrot-graph.mjs"
metrics:
  duration: "~15 min"
  completed: "2026-05-19"
---

# Phase 19 Plan 02: Resolved Routes + Undo + Cross-Namespace Smoke Summary

Two HTTP route changes (`GET /api/dashboard/todos?view=resolved` + `POST /api/dashboard/todos/:id/unresolve`) and one new smoke-test invariant (`auto_clear_valid_to_resolves_todo`) that proves the Phase 19 grace-period Cypher actually finds expired :Todo nodes end-to-end against FalkorDB.

## What Shipped

- **`GET /api/dashboard/todos?view=resolved`**: branches in the existing dashboard todos route. When `view === "resolved"`, calls `stub.getResolvedTodos()` (added to the DO in Plan 19-01) and returns `{ todos: [...] }`. All other views (`all|mentions|today|week`) hit the unchanged `getTodos(view)` path — regression-safe.
- **`POST /api/dashboard/todos/:id/unresolve`**: new Hono route. Calls `stub.unresolveTodo(todoId)` for the SQLite-row clear (primary action). Then fires a fail-soft `MATCH (t:Todo {id: $tid}) SET t.valid_to = null` against the graph proxy — wrapped in `try {} catch {}` so the route returns `200 { ok: true, unresolved: bool }` even if the proxy is unreachable, returns 5xx, or times out. The DO row is authoritative for the dashboard; the graph staying briefly stale is acceptable until the next `recordTodoFact` write overwrites it.
- **`infra/graph-api/smoke.mjs` invariant 5/5**: `auto_clear_valid_to_resolves_todo`. Seeds a `:Todo` node with `valid_to = now() - 10min`, then re-runs the EXACT `FIND_CLOSED_TODOS_CYPHER` from `workers/lib/auto-clear.ts` and confirms the seeded node appears as a closed-todo candidate. Cleanup `MATCH ... DELETE` in a `finally` block.

## Decisions Made

- **Undo is fail-soft on the graph side.** The plan's truths required the route to return success even when graph is unreachable. I wrapped the entire graph fetch in a wide `try { await fetch(...); } catch {}` block. The DO row clear is the user-visible action; the graph reconciliation is best-effort.
- **Smoke test landed in `infra/graph-api/smoke.mjs`, not the legacy `apps/parrot/scripts/smoke-parrot-graph.mjs`.** The plan's `files_modified` referenced `apps/parrot/scripts/smoke-parrot-graph.ts`, but Phase 18 EXECUTION-REPORT documents that the live smoke runner (the one wired to `npm run smoke:parrot-graph` at the repo root) is `infra/graph-api/smoke.mjs`. Extending the active runner is the correct call; the legacy `apps/parrot/scripts/smoke-parrot-graph.mjs` is documented in Phase 18's report as "stale, could be deleted in a follow-up cleanup commit." Documented as a deviation.
- **Test 5/5 numbering.** Updated final-result message to use `${total}` instead of hardcoded `/4` so future invariants don't lie about the count.

## Verification Results

```
grep "getResolvedTodos|unresolveTodo" durableObject/index.ts → both present (added in Plan 01)
grep 'view === "resolved"|unresolve' workers/index.ts → both new routes present
grep "auto_clear_valid_to_resolves_todo|auto_clear" smoke.mjs → invariant + cleanup wired

apps/parrot && npx tsc --noEmit → exit 0 (clean)
node --check infra/graph-api/smoke.mjs → OK
```

The smoke invariant itself requires `GRAPH_API_URL` + `GRAPH_API_SECRET` to be set against a real graph proxy + FalkorDB — NOT runnable in this executor's sandbox (constraint: no production-mutating commands, and the graph proxy is on Fly). HUMAN-ACTION to run after Phase 18 is deployed:

```
GRAPH_API_URL=https://internjobs-graph-api.fly.dev \
GRAPH_API_SECRET=$(infisical secrets get GRAPH_API_SECRET ... --plain) \
node infra/graph-api/smoke.mjs
# expect: 5/5 PASS, exit 0
```

## Files

- Modified: `apps/parrot/workers/index.ts` (+72 lines for resolved branch + unresolve route)
- Modified: `infra/graph-api/smoke.mjs` (+92 lines for invariant 5/5 + cleanup)

## Commit

`218d879 feat(19-02): add Resolved + Undo routes and auto-clear smoke invariant`

## Deviations from Plan

- **Smoke test in `infra/graph-api/smoke.mjs` instead of `apps/parrot/scripts/smoke-parrot-graph.ts`.** See Decisions above. The plan's path is stale; the live runner is the Phase 18 one.
- **DO method `getResolvedTodos` co-located in Plan 19-01 commit (`6415650`), not this commit.** Already documented in 19-01-SUMMARY.

## Authentication Gates

None during execution. Production smoke test requires `GRAPH_API_SECRET` from Infisical (HUMAN-ACTION, listed in EXECUTION-REPORT).
