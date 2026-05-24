---
schema_version: 2
milestone: "v1.4"
phase: 0
phase_name: "Defining requirements"
phase_total: 0
plan: 0
plan_total: 0
status: "defining_requirements"
progress: 0
last_activity: "2026-05-24"
session_last: "2026-05-24"
resume_file: ".planning/milestones/v1.4-pilot-readiness/SCOPE.md"
blockers: []
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-24)
See: .planning/MILESTONES.md (full v1.0 / v1.1 / v1.2 / v1.3 ship history)
See: .planning/milestones/v1.4-pilot-readiness/SCOPE.md (initial v1.4 scope draft)
See: .planning/codebase/ (codebase map written 2026-05-24)
See: .planning/team-mode.json (RRR team mode initialized 2026-05-24)
See: .planning/WORKSTREAMS.md (team assignments)

**Core value:** InternJobs.ai helps students and startups meet through natural messages, not resume piles or application black holes.
**Current focus:** v1.4 Pilot Readiness — close v1.3 dangling work + complete Neon-exit + Workspace upgrades

## Current Position

Milestone: v1.4 Pilot Readiness
Phase: Not started (run `/rrr:create-roadmap`)
Plan: —
Status: Defining requirements (scope drafted; phases TBD)
Last activity: 2026-05-24 — Milestone v1.4 started under RRR team mode (first team-mode milestone for this repo)

Progress: ░░░░░░░░░░ 0% (scope drafted; no phases yet)

## Team Mode

This milestone runs under **RRR team mode** (initialized 2026-05-24).

- `team-cms` (Raj) — owns Marketing CMS (`apps/marketing/`) + Student app (`apps/app/`) + Mac bridge + student-db. Branch `rrr/v1.4/team-cms`.
- `team-workspace` (other dev) — owns Workspace app (`apps/parrot/`) + agentic-inbox + Mattermost stack + graph-api + mattermost-db. Branch `rrr/v1.4/team-workspace`.

Coordinator workflow: each team works on their own branch; root `.planning/STATE.md` is coordinator-owned; integration via `integration/v1.4` branch via coordinator-driven `coordinate-merge`.

See: `.planning/workstreams/{team-cms,team-workspace}/{STATE.md,ASSIGNMENT.md}`

## Accumulated Context

### v1.3 outcome (what shipped, what carried)

- **Shipped:** PHASE14-RUNTIME (Phase 18), PARROT-AUTO-CLEAR infra (Phase 19, cron inert), SAFETY-01 code (Phase 20, tests pending), Neon-exit (un-roadmapped).
- **Skipped:** SEC-ROTATE (Phase 21) — sole-user deferral; RUNBOOK preserved.
- **Carried into v1.4:** closeTodoFact writer (A1), 3 Lakera tests (A2), Lakera v2 schema verify (A3), attachment download (A4), agent-lift UAT (A5), Neon-exit closeout (B1-B3), v1.3 carryovers from parrot-agent-roadmap memory (C1-C4).

### Decisions

Recent v1.4 decisions (to add to PROJECT.md Key Decisions table as they're locked):
- Use RRR team mode for v1.4 (first team-mode milestone)
- Two-team split: team-cms (external surfaces) + team-workspace (employee surfaces)
- "Workspace" is the verbal/written name for the worker-side app (code paths still use `apps/parrot/`)

### Pending Todos (for /rrr:create-roadmap)

- Decide phase grouping: conservative 4-phase (Phase 22 v1.3 closeout / Phase 23 auth+admin / Phase 24 graph / Phase 25 polish+tests) vs aggressive 2-phase (pilot-blockers first, then everything else)
- Decide whether to do milestone research or jump to define-requirements (recommend skip — codebase mapped + scope is mostly closeout work)
- Decide pilot-launch criteria (what MUST be true before first pilot user signs in)

### Blockers/Concerns

None blocking start of v1.4 planning. External vendor gate persists from v1.3: Lakera (Cisco AI Defense) API drift — A3 must verify before A2 tests are meaningful.

## Session Continuity

Last session: 2026-05-24 — Codebase mapped, v1.4 drafted, RRR team mode initialized for v1.4 with team-cms + team-workspace, PROJECT.md updated for v1.4 (v1.3 moved to Validated).
Stopped at: PROJECT.md / STATE.md updated; ready to run `/rrr:define-requirements` or `/rrr:create-roadmap` for v1.4.
Resume file: `.planning/milestones/v1.4-pilot-readiness/SCOPE.md`
