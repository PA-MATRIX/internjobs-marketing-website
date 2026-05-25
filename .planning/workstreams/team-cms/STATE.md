---
schema_version: 1
team: "team-cms"
milestone: "v1.4"
current_phase: 24
plan_total: 2
status: in-progress
last_activity: "2026-05-25"
---

# team-cms Workstream State

## Source Of Truth

- GitHub issue/phase assignment owns task status.
- GitHub branch/PR owns code status.
- This file is local execution memory for RRR only.
- Root `.planning/STATE.md` is coordinator-owned in team mode.

## Assignment

GitHub team: @PA-MATRIX/team-cms
Branch: rrr/v1.4/team-cms
Sprite: rrr-internjobs-marketing-website-v1-4-team-cms
Phases: 22, 24, 28, 28.5, 29

## Current Position

Status: In progress — Phase 24 wave 1 executing (24-02 shipped, 24-01 running in parallel)
Current phase: 24 (Neon-Exit Closeout)
Current plan: 24-02 ✓ shipped (docs refresh); 24-01 in flight (parallel)
Blockers: None

### Plan 24-02 completion (2026-05-25)

Docs refresh shipped: HANDOFF.md §4 (post-Neon-exit topology), ROADMAP.md
Phase 24 plan list (TBD → 2 plans), infisical-project memory (5 post-exit
secrets). NEONEX-DOC-01..03 all PASS. Status-row + checkbox updates in
ROADMAP.md intentionally deferred to orchestrator at phase close.

Commits: `23a683c` (HANDOFF.md), `0e9e876` (ROADMAP.md). Memory file (outside
repo) updated via filesystem write — no git commit needed.

Summary: `.planning/milestones/v1.4-pilot-readiness/phases/24-neon-exit-closeout/24-02-SUMMARY.md`

## Completed phases (team-cms)

- **Phase 22** — Lakera Verification + Marketing Brand Refresh (5/5 plans, shipped 2026-05-24)
- **Phase 28** — Startup MCP Server + Channel-Adapter Core (5/5 plans, shipped 2026-05-25; live first-pilot install deferred to v1.5 STARTUP-PILOT-LIVE-01)

## Remaining phases (team-cms)

- **Phase 24** — Neon-Exit Closeout *(current — 2 plans planned)* — verification + docs refresh; no code changes expected
- **Phase 28.5** — Startups Web App + Clerk #3 + Per-Startup Agent Email
- **Phase 29** — Startup Telnyx SMS + Voice AI + Voice-Based Onboarding

## Phase 24 plan summary

| Plan | Objective | Wave | Deps |
|------|-----------|------|------|
| 24-01 | E2E safety_events API verification + negative tests (NEONEX-VER-01..04) | 1 | none |
| 24-02 | Docs refresh — HANDOFF.md, ROADMAP.md, infisical-project memory (NEONEX-DOC-01..03) | 1 | none |

Both plans are wave 1 and independent — can execute in either order or in
parallel if two executor contexts are available. 24-01 is verification work
(curl probes against live prod); 24-02 is docs-only.

## Notes

Owns external-facing surfaces:
- **Marketing CMS** (`apps/marketing/`) — public site at `internjobs.ai`
- **Student app** (`apps/app/`) — student-facing app at `app.internjobs.ai`
- **Startup MCP server** (`apps/startup/`) — MCP server at `mcp.internjobs.ai` *(shipped Phase 28)*
- **Startup Fly proxy** (`infra/startup-api/`) — REST bridge to Postgres *(shipped Phase 28)*
- **Startups web app** (`apps/startups/`) — founder-facing dashboard at `startups.internjobs.ai` *(Phase 28.5 will create)*
- **iMessage bridge** (`apps/mac-bridge/`) — student SMS/iMessage path
- **Student DB** (`infra/student-db/`) — self-hosted Fly Postgres

The team name `team-cms` is shorthand for "external/customer-facing surfaces" — it
covers Marketing CMS + Student app + Startup-side, not marketing alone. The other team
(`team-workspace`) owns the employee-facing Workspace app (`apps/parrot/`).
See `[[project-app-naming]]` memory note.

## Process exceptions

Phase 22 + Phase 28 were executed directly on `main` (single-dev shortcut while
team-workspace's branch wasn't live). From Phase 28.5 forward, work moves to the
`rrr/v1.4/team-cms` branch + PR flow to keep parity with team-workspace's branch
and protect against merge conflicts with Nithin's work landing on main.
