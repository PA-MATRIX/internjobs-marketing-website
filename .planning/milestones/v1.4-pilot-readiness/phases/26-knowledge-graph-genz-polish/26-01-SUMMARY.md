---
phase: 26-knowledge-graph-genz-polish
plan: "01"
status: passed
subsystem: knowledge-graph
tags: [falkordb, kimi, cloudflare-workers, ai-gateway, graph, cypher, blocked_by]

# Dependency graph
requires:
  - phase: 14-knowledge-graph
    provides: getEmployeeContext + recordTodoFact + contextBlock prepend (shipped Wave 2)
  - phase: 18-graph-api-proxy
    provides: internjobs-graph-api Fly proxy (POST /query Cypher contract)
provides:
  - ":BLOCKED_BY edge type on Todo nodes (write path live in recordTodoFact Step 5)"
  - "ExtractedTodo.blocked_by_ids?: string[] surfaced from kimi extraction"
  - "scripts/26-kgraph-smoke.mjs cross-namespace isolation harness"
  - "scripts/26-kgraph-ab.mjs A/B comparison harness for context-prepend value"
affects:
  - "Future agent surfaces that need blocker-aware todo retrieval (v1.5 candidate)"
  - "Operator workflows that run weekly cross-namespace audits"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - ":BLOCKED_BY MERGE in recordTodoFact Step 5 (NOT gated by !skipped — retroactive blocker discovery is meaningful and MERGE is idempotent)"
    - "kimi schema extension pattern: add field to ExtractedTodo + TODO_EXTRACTION_SCHEMA + extraction_rules prompt block + propagate via call sites"
    - "Operator smoke scripts use depth-bounded MATCH ([*1..5]) instead of unbounded to avoid timeouts on sparse graphs"

key-files:
  created:
    - scripts/26-kgraph-smoke.mjs
    - scripts/26-kgraph-ab.mjs
  modified:
    - apps/parrot/workers/lib/ai.ts
    - apps/parrot/workers/lib/graph.ts
    - apps/parrot/workers/durableObject/index.ts

key-decisions:
  - ":BLOCKED_BY source = kimi schema field (cleaner than post-hoc heuristic; aligns with mentioned_actors pattern)"
  - ":BLOCKED_BY MERGE is NOT gated by !skipped — retroactive blocker discovery on re-run is meaningful and the MERGE is idempotent"
  - ":Blocker nodes are stub nodes keyed by description text (no separate index) — just anchors for future retrieval, not first-class graph entities"
  - "KGRAPH-01..03 were verify-not-build (all three shipped in Phase 14 Wave 2); plan 26-01 only adds the :BLOCKED_BY edge + verification scripts"

# Metrics
duration: ~8 min
completed: 2026-05-27
---

# Phase 26 Plan 01: Knowledge Graph Verify + :BLOCKED_BY Summary

**:BLOCKED_BY edge type added to recordTodoFact (Step 5 MERGE), ExtractedTodo gains blocked_by_ids field plumbed through email + chat extraction call sites, plus two operator scripts (cross-namespace smoke + extraction A/B) closing the KGRAPH-01..05 requirement group.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-26T19:37:38Z
- **Completed:** 2026-05-26T19:45:21Z
- **Tasks:** 2
- **Files modified:** 3 (production) + 2 created (scripts)

## Accomplishments

- KGRAPH-01..03 grep-verified live (no rebuild; Phase 14 Wave 2 still holds).
- KGRAPH-02 gap closed: :BLOCKED_BY edge writes from `recordTodoFact` Step 5 — ungated, idempotent.
- KGRAPH-04 smoke script ships: 2-direction Employee↔Student isolation check against live Fly graph-api.
- KGRAPH-05 A/B harness ships: per-email side-by-side comparison of extraction with vs without `getEmployeeContext` block.

## Task Commits

1. **Task 1: Verify KGRAPH-01..03 + add :BLOCKED_BY schema (ai.ts, graph.ts, durableObject/index.ts)** — `6d44eb0` (feat)
2. **Task 2: Add cross-namespace smoke + A/B harness scripts** — `6e4f9a9` (feat)

_Note: Task 1 commit was created via `git commit --amend` because the initial `git commit -m` somehow attached an unrelated commit message; the file changes were correct and intact (verified via diff before amending). No history loss._

## Files Created/Modified

### Modified

- `apps/parrot/workers/lib/ai.ts` — `ExtractedTodo` gains `blocked_by_ids?: string[]`; `TODO_EXTRACTION_SCHEMA` emits the array; system prompt's `<extraction_rules>` instructs kimi to surface "blocked by"/"waiting on"/"depends on" language. (Lines 35-46 interface, 58-83 schema, 288 prompt.)
- `apps/parrot/workers/lib/graph.ts` — `RecordTodoFactArgs` gains `blockedByIds?: string[]` (line 295); new Step 5 block (lines 474-501) MERGEs `(:Todo)-[:BLOCKED_BY]->(:Blocker {desc})` per id. Comment block explicitly documents the "NOT gated by !skipped" rationale.
- `apps/parrot/workers/durableObject/index.ts` — both `recordTodoFact` call sites pass `blockedByIds: t.blocked_by_ids ?? []` (line 980 email path, line 1174 chat path).

### Created

- `scripts/26-kgraph-smoke.mjs` — KGRAPH-04 cross-namespace isolation smoke test. Posts `MATCH (e:Employee)-[*1..5]->(n:Student) RETURN count(n)` (and reverse) to the live `/query` endpoint; asserts both counts = 0. Exit 0 PASS / 1 FAIL / 2 infra unavailable.
- `scripts/26-kgraph-ab.mjs` — KGRAPH-05 A/B comparison harness. Fetches `<employee_context>` once, then for each email runs the kimi extractor twice (empty context vs prepended context), prints per-email side-by-side counts + delta + summary table. `cf-aig-cache-ttl=0` always (A/B must be live inference).

## KGRAPH-01..03 Verification Evidence (grep)

| Requirement | File | Lines | Symbol |
|-------------|------|-------|--------|
| KGRAPH-01 (getEmployeeContext live) | `apps/parrot/workers/lib/graph.ts` | 737-784 | `export async function getEmployeeContext` — 1500-char cap, `<employee_context>` XML fence |
| KGRAPH-01 (DO call site, email) | `apps/parrot/workers/durableObject/index.ts` | 932-940 | `getEmployeeContext(this.env, employeeId)` then `extractTodosFromText(..., contextBlock ‖ undefined)` |
| KGRAPH-01 (DO call site, chat) | `apps/parrot/workers/durableObject/index.ts` | 1119-1128 | same pattern |
| KGRAPH-02 (recordTodoFact live) | `apps/parrot/workers/lib/graph.ts` | 321-472 (pre-Step-5); +474-501 (new Step 5) | fire-and-forget MERGE writes, dedup via `todoHash` |
| KGRAPH-03 (contextBlock prepend) | `apps/parrot/workers/lib/ai.ts` | 250-252 | `const systemPrefix = hasContext ? \`${contextBlock}\n\n\` : ""`; `effectiveCacheTtl = hasContext ? 0 : cacheTtl` |
| KGRAPH-03 (namespace isolation comment) | `apps/parrot/workers/lib/graph.ts` | 16-25 | "isolation between student-app and Parrot facts is by LABEL NAMESPACE, not by graph" |

## Decisions Made

- **`:BLOCKED_BY` source = kimi schema field, not heuristic.** Rationale: cleaner than parsing "blocked by"/"waiting on" with regex; surfaced to all downstream callers via the typed `ExtractedTodo.blocked_by_ids`; aligns with the existing `mentioned_actors` extraction pattern.
- **`:BLOCKED_BY` MERGE is NOT gated by `!skipped`** (unlike `:MENTIONS`). Locked by plan-checker pre-execution. Rationale: blocker discovery on re-run is meaningful (a re-extracted todo may have new blockers); MERGE is idempotent (writing the same edge twice is a no-op); retroactive add is safe.
- **`:Blocker` nodes are stub nodes keyed by description text.** No separate index, no canonicalization, no NLP normalization. Just an anchor for future retrieval. v1.5 candidate: dedupe by embedding similarity if collaborator names start surfacing.

## Deviations from Plan

None — plan executed exactly as written. The plan's decision locks (kimi schema source for :BLOCKED_BY, ungated MERGE, KGRAPH-01..03 verify-not-build) were honored verbatim.

## Issues Encountered

- **Commit-message swap on first commit attempt.** When committing Task 1, the message attached to commit `2de4a0e` was `feat(26-02): wire first_todo_resolved confetti...` (from the prior plan in this branch) even though the file changes (ai.ts/graph.ts/durableObject) were correct and unmistakably my Task 1 work. Cause is unclear (possibly a tooling buffer issue across parallel agents). Resolved with `git commit --amend -m "<correct 26-01 message>"`; no history loss because no other agent's work was in the staging area and the commit had not been pushed. Final Task 1 hash: `6d44eb0`.
- **Sibling working-tree changes (26-02).** `apps/parrot/app/lib/confetti.ts`, `app/routes/dashboard.tsx`, `app/components/ComposePane.tsx`, `app/components/ParrotMascot.tsx`, `apps/parrot/docs/` were modified/untracked when I started — they belong to plan 26-02 (running in parallel under the same branch per the Phase 26 plan map). I explicitly `git restore --staged` for those before staging Task 1's files; left them in the working tree for the 26-02 executor to commit.

## Verification Results

| Check | Result |
|-------|--------|
| `cd apps/parrot && npx tsc --noEmit` | exit 0 (clean) |
| `node --check scripts/26-kgraph-smoke.mjs` | OK |
| `node --check scripts/26-kgraph-ab.mjs` | OK |
| `node scripts/26-kgraph-smoke.mjs` (no env vars) | exit 2 with clean usage error |
| `node scripts/26-kgraph-ab.mjs` (no env vars) | exit 2 with clean usage error |
| `grep blocked_by_ids apps/parrot/workers/lib/ai.ts` | 4 hits (interface, schema doc, schema field, prompt) |
| `grep BLOCKED_BY apps/parrot/workers/lib/graph.ts` | 4 hits (Step 5 comments + Cypher) |
| `grep blockedByIds apps/parrot/workers/lib/graph.ts` | 3 hits (interface + 2 in Step 5 loop) |
| `grep blockedByIds apps/parrot/workers/durableObject/index.ts` | 2 hits (email + chat call sites) |

### Live smoke test

**Deferred — env vars not available in executor.** Operator should run:

```bash
GRAPH_API_URL=$GRAPH_API_URL GRAPH_API_SECRET=$GRAPH_API_SECRET \
  node scripts/26-kgraph-smoke.mjs
```

Expected output:

```
KGRAPH-04 smoke test
  [PASS] Employee->Student cross-namespace: 0
  [PASS] Student->Employee cross-namespace: 0
All checks passed.
```

Exit 0 = PASS. Exit 1 = real cross-namespace contamination (escalate). Exit 2 = infra unreachable (re-try once, then escalate).

### Live A/B harness

**Deferred — requires operator to assemble 10 representative email bodies + their own employee context.**

Operator runbook:

1. Save 10 representative email bodies to `emails.json` (JSON array of strings).
2. Export env: `GRAPH_API_URL`, `GRAPH_API_SECRET`, `CF_AI_GATEWAY_URL` (full URL including `/workers-ai/{model}` suffix), `CF_AI_GATEWAY_TOKEN`, `EMPLOYEE_ID` (Clerk user_id of a real employee with open todos in FalkorDB).
3. Run: `node scripts/26-kgraph-ab.mjs emails.json | tee ab-result.txt`
4. Review per-email diffs. Look for: (a) duplicates suppressed when an open todo already covers the new email's ask; (b) preserved-new-todos count holding steady (context shouldn't suppress NEW asks).
5. Summary table at the end reports `Net delta` — negative means context successfully suppressed duplicate extraction; near-zero means context had no measurable effect on volume (review individual diffs for quality changes).

## Next Phase Readiness

- **KGRAPH track closed.** All 5 KGRAPH requirements have shipping code; KGRAPH-04/05 verification awaits operator runs with real credentials.
- **Plan 26-02 (GENZ polish) unblocked.** It runs parallel to 26-01 under the same Phase 26 branch; its files (`apps/parrot/app/{components,routes,lib}`) do not overlap with this plan's worker-side surface.
- **No new blockers introduced.**

---
*Phase: 26-knowledge-graph-genz-polish*
*Plan: 01*
*Completed: 2026-05-27*
