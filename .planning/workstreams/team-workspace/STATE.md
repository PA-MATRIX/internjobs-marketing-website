---
schema_version: 1
team: "team-workspace"
milestone: "v1.4"
status: "in_progress"
last_activity: "2026-05-26"
---

# team-workspace Workstream State

## Source Of Truth

- GitHub issue/phase assignment owns task status.
- GitHub branch/PR owns code status.
- This file is local execution memory for RRR only.
- Root `.planning/STATE.md` is coordinator-owned in team mode.

## Assignment

GitHub team: @PA-MATRIX/team-workspace
Branch: rrr/v1.4/team-workspace-23
Sprite: rrr-internjobs-marketing-website-v1-4-team-workspace
Phases: 23 (active), 25, 26, 27 (queued)

## Current Position

Status: In progress — 23-01 shipped + live-smoke verified on graph-api Fly proxy
Current phase: 23 (Workspace Pilot Closeouts)
Current plan: 23-01 complete; 23-02 / 23-03 / 23-04 ready
Blockers: None (Phase 22 shipped 2026-05-24; unblocks SAFETY-VERIFY-LIVE-04)

## Phase 23 Plan Status

| Plan | Objective | Wave | Status |
|------|-----------|------|--------|
| 23-01 | closeTodoFact Cypher helper + reply path integration | 1 | **complete** (1b0b509 + d6681d7; deploy + smoke PASS 2026-05-26) |
| 23-02 | SAFETY-VERIFY-LIVE-04 — email injection test | 1 | ready |
| 23-03 | Attachment download route + EmailPanel wire-up | 1 | ready |
| 23-04 | 14-step authenticated agent-lift UAT | 1 | ready |

All 4 plans are Wave 1 — fully parallel (no file overlap between plans). 23-01 closed in isolation; the other three remain non-overlapping with 23-01's modified files.

## 23-01 Decisions Captured

- RFC-5322 threadId (from buildReferencesChain) is NOT the :Todo key — `c.req.param('id')` (DO-internal UUID) is what recordTodoFact stored as source_id. Documented inline in reply-forward.ts.
- ACK regex intentionally loose (`got it / fixed / done / sent / shipped`, case-insensitive). False positives acceptable; false negatives not.
- closeTodoFact is fail-soft (returns null on any error). The reply 202 must succeed even when the graph layer is down — graph state is best-effort.
- graph-api Cypher uses `SET t.valid_to = timestamp()` (no datetime() / duration() — FalkorDB doesn't implement those openCypher temporal functions). The 5-minute grace window is enforced cron-side.
- Worker deploy (`cd apps/parrot && wrangler deploy`) deferred to coordinator integration — graph-api side ships standalone and is live.

## Key Context

- Naming: code says `parrot`, narrative says `Workspace`. Both used consistently.
- FalkorDB writes go through infra/graph-api Fly proxy (never direct from Worker).
- closeTodoFact: new POST /close-todo endpoint on graph-api + new closeTodoFact() in graph.ts.
- Safety email path: binary-flag parser (flagged===true || score>=0.8) already fixed in 22-01.
  23-02 verifies it live on the email path + adds source_id to safety_events payload.
- Attachment R2 key convention: attachments/{clerk_user_id}/{messageId}/{attachmentId}/{filename}
- PARROT_AGENT_TOOLS (11 tools) vs startup-MCP (4 tools at mcp.internjobs.ai) — completely
  separate servers. 23-04 tests the internal Workspace tools ONLY.

## Notes

Owns the worker-side **Workspace** app. Code paths still use `apps/parrot/` (the
worker is named `internjobs-parrot` in Cloudflare); the verbal/written reference
in planning docs is **Workspace** to avoid confusion with an unrelated, now-deleted
Neon project that was also called "parrot".

Phase 22 (Lakera v2 parser fix) shipped 2026-05-24 and is a hard dependency for
Phase 23's SAFETY-VERIFY-LIVE-04. Confirmed unblocked per STATE.md "Blockers: None".
