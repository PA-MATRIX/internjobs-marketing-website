---
schema_version: 1
team: "team-workspace"
milestone: "v1.4"
status: "planning_complete"
last_activity: "2026-05-25"
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

Status: Planning complete — Phase 23 plans ready for execution
Current phase: 23 (Workspace Pilot Closeouts)
Current plan: —
Blockers: None (Phase 22 shipped 2026-05-24; unblocks SAFETY-VERIFY-LIVE-04)

## Phase 23 Plan Status

| Plan | Objective | Wave | Status |
|------|-----------|------|--------|
| 23-01 | closeTodoFact Cypher helper + reply path integration | 1 | ready |
| 23-02 | SAFETY-VERIFY-LIVE-04 — email injection test | 1 | ready |
| 23-03 | Attachment download route + EmailPanel wire-up | 1 | ready |
| 23-04 | 14-step authenticated agent-lift UAT | 1 | ready |

All 4 plans are Wave 1 — fully parallel (no file overlap between plans).

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
