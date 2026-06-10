---
phase: "23"
plan: "01"
subsystem: "workspace"
tags: ["closeTodoFact", "FalkorDB", "graph-api", "auto-clear", "todo-resolution", "reply-handler"]
requires:
  - "v1.3 Phase 18 (graph-api Fly proxy)"
  - "v1.3 Phase 19 (runAutoClear cron — was inert until this plan)"
provides:
  - "POST /close-todo endpoint on internjobs-graph-api (Fly)"
  - "closeTodoFact(env, args) export in apps/parrot/workers/lib/graph.ts"
  - "Reply-path acknowledgement detection (ACK_PATTERN regex) wired to graph close"
  - "Structured event=todo_fact_closed log on each close"
affects:
  - "Phase 19 runAutoClear cron — now functional end-to-end"
  - "Workspace Resolved view — todos now flow there after acknowledgement reply"
  - "Phase 25/26/27 — graph close-out semantics available for future workspace flows"
tech-stack:
  added: []
  patterns:
    - "Fail-soft graph writer (fire-and-forget via c.executionCtx.waitUntil — reply 202 never blocked by graph state)"
    - "DO-UUID-not-RFC-Message-ID as the threadId key into FalkorDB (matches recordTodoFact's source_id contract)"
key-files:
  created: []
  modified:
    - "infra/graph-api/src/index.mjs"
    - "apps/parrot/workers/lib/graph.ts"
    - "apps/parrot/workers/routes/reply-forward.ts"
decisions:
  - "RFC-5322 threadId (from buildReferencesChain) is NOT used as :Todo.source_id key — c.req.param('id') (DO-internal UUID) is. The RFC threadId is a Message-ID header string that recordTodoFact never wrote, so it would match zero :Todo nodes. Documented inline at reply-forward.ts."
  - "ACK regex is intentionally loose (false positives acceptable, false negatives not). Phrase set: got it / fixed / done / sent / shipped. Tuning will come from pilot observation, not pre-pilot guessing."
  - "closeTodoFact returns null on any failure (fail-soft) instead of throwing — the reply path uses waitUntil and the user's reply must succeed even if the graph layer is down."
  - "graph-api endpoint Cypher uses simple SET t.valid_to = timestamp() with no datetime() / duration() — FalkorDB doesn't implement those openCypher temporal functions (verified in v1.3 Phase 19 smoke). The 5-minute grace window is enforced cron-side, not here."
metrics:
  duration: "~25 min (read context + 2 edits + tsc + deploy + 3 smoke probes + push + docs)"
  completed: "2026-05-26"
---

# Phase 23 Plan 01: closeTodoFact Cypher Helper + Reply-Path Integration — Summary

**One-liner:** Adds the missing `closeTodoFact` writer (graph-api POST /close-todo + parrot Worker helper + reply-handler ACK detection) that v1.3 Phase 19's auto-clear cron needs to actually close SQLite todos when an agent reply contains a resolution-acknowledgement phrase.

## What Shipped

### Commits

| Task | Description | Commit |
|------|-------------|--------|
| 1 | POST /close-todo endpoint on internjobs-graph-api (Bearer auth, SET t.valid_to = timestamp() Cypher, structured error envelope mirroring /query) | `1b0b509` |
| 2 | closeTodoFact() in apps/parrot/workers/lib/graph.ts + ACK_PATTERN regex + waitUntil call in handleReplyEmail | `d6681d7` |

### Endpoint surface (live on internjobs-graph-api.fly.dev)

```
POST /close-todo
Authorization: Bearer <GRAPH_API_SECRET>
Content-Type: application/json
Body: { thread_id: string, employee_id: string, resolution_text?: string }

200 { ok: true, closed_count: number }     # SET ran (closed_count=0 if no match)
400 { error: "thread_id_and_employee_id_required" }
400 { error: "invalid_json" }
401 { error: "unauthorized" }
500 { error: "close_failed", detail: string }
503 { error: "falkordb_unreachable" }
```

### Reply-handler flow

`POST /api/inbox/messages/:id/reply` → after `stub.markThreadRead(threadId)`:
1. Strip HTML, test body against `ACK_PATTERN = /\b(got\s+it|fixed|done|sent|shipped)\b/i`
2. On match: `c.executionCtx.waitUntil(closeTodoFact(c.env, { threadId: id, employeeId: employee.employeeId ?? employee.email, resolutionText: matchedPhrase }))`
3. Reply 202 returns immediately; graph write is fire-and-forget

## Live Smoke Evidence

Deploy: `flyctl deploy --app internjobs-graph-api` succeeded — 2/2 machines rolled to new image `deployment-01KSG8BAQ5D9SGNP4DBXKEX068` (image size 71 MB), both reached healthy state.

Smoke (3/3 PASS):

| Probe | Result |
|-------|--------|
| `GET /health` (existing endpoint, regression check) | `HTTP=200` |
| `POST /close-todo` no Bearer | `HTTP=401 BODY={"error":"unauthorized"}` |
| `POST /close-todo` Bearer + valid body, non-existent thread (via Fly SSH) | `HTTP=200 BODY={"ok":true,"closed_count":0}` |
| `POST /close-todo` Bearer + missing employee_id (via Fly SSH) | `HTTP=400 BODY={"error":"thread_id_and_employee_id_required"}` |

Cypher round-tripped to FalkorDB and back without error — the SET path runs on a real connection. `closed_count=0` for the smoke thread is correct (no `:Todo` node exists with `source_id='smoke-23-01-noexist'`).

## Verification

| Step | Result |
|------|--------|
| `node --check infra/graph-api/src/index.mjs` | PASS |
| `cd apps/parrot && npx tsc --noEmit` | PASS (exit 0, zero errors — the pre-existing STUDENT_API_URL note in the plan did not trigger in current config) |
| `grep -n "close-todo" infra/graph-api/src/index.mjs` | 3 hits (comment + comment + route handler) |
| `grep -n "valid_to" infra/graph-api/src/index.mjs` | 5 hits including `SET t.valid_to = timestamp()` |
| `grep -n "closeTodoFact" apps/parrot/workers/lib/graph.ts` | 2 hits (doc + export) |
| `grep -n "todo_fact_closed" apps/parrot/workers/lib/graph.ts` | 1 hit (structured log event) |
| `grep -n "closeTodoFact\|ACK_PATTERN" apps/parrot/workers/routes/reply-forward.ts` | 5 hits (import + const + regex test + waitUntil call comment + call) |

## Requirements Closed

- **CLOSETODO-01** — closeTodoFact helper added to apps/parrot/workers/lib/graph.ts (signature + interfaces match plan exactly)
- **CLOSETODO-02** — Workspace Worker reply path invokes closeTodoFact on ACK_PATTERN match (fire-and-forget via waitUntil)
- **CLOSETODO-04** — Structured log `{level:"info",event:"todo_fact_closed",thread_id,employee_id,matched_phrase,closed_count}` emitted on each successful close

**CLOSETODO-03 (end-to-end SQLite close-out)** — partially verified. The graph-api side is live and Cypher round-trips correctly. The full chain (Worker reply → :Todo.valid_to set → cron tick within 10 min → DO.resolveTodo → SQLite resolved_at flip → Resolved view update) requires a live `wrangler deploy` of apps/parrot (deferred to coordinator integration) AND a real authenticated reply with a seeded :Todo. The smoke evidence above confirms the missing piece (the writer) now works; the rest of the chain shipped in v1.3 Phases 18 + 19 and was already verified there.

## Deployment Note

`flyctl deploy --app internjobs-graph-api` ran successfully from local checkout — image deployed, 2/2 machines healthy, DNS verified. The graph-api Fly proxy serves the new `/close-todo` route immediately.

The corresponding Worker deploy (`cd apps/parrot && wrangler deploy`) is NOT part of this plan's scope — the user's RRR team-mode coordinator handles cross-team integration. Once that Worker deploy ships:
1. Any agent reply containing "got it" / "fixed" / "done" / "sent" / "shipped" will trigger a `closeTodoFact` call
2. The runAutoClear cron (`*/5 * * * *`) will see `valid_to` past the 5-min grace window within at most 10 minutes
3. `EmployeeMailboxDO.resolveTodo()` flips the SQLite row → Resolved view populates

## Deviations from Plan

None. Plan executed exactly as written.

The plan-stated `npx tsc --noEmit` "pre-existing STUDENT_API_URL error" did NOT appear during execution (exit code 0, zero errors). Either the underlying types issue resolved between plan-write and execution, or the apps/parrot tsconfig was tightened. Either way: clean TS — no shim or workaround needed.

## Files Modified (drift check)

`git diff --cached --name-only` at commit time matched plan `files_modified` frontmatter exactly:

- `infra/graph-api/src/index.mjs` (declared)
- `apps/parrot/workers/lib/graph.ts` (declared)
- `apps/parrot/workers/routes/reply-forward.ts` (declared)

No extras. No drift.

## Follow-ups (not blocking)

- **Pilot observation: ACK regex tuning.** The phrase set is best-effort. Once pilots run, dashboard a daily count of `event=todo_fact_closed` vs. `event=auto_clear_resolved` — divergence signals a leak (phrases that should fire don't, or fire on the wrong thread). Tune in v1.5 if signal demands.
- **closed_count > 1 telemetry.** When SET matches multiple :Todo nodes (re-extraction re-runs), the structured log records the count. Not surfacing this in any dashboard yet; v1.5 candidate if multi-row closes become common.
- **CLOSETODO-03 end-to-end verification post-Worker-deploy.** Coordinator/Raj will run the live "got it, sending now" reply test after the apps/parrot wrangler deploy lands and confirm the Resolved view updates within 10 minutes. Out of this plan's scope.
