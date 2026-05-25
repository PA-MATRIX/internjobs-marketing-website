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

Status: In progress — Phase 24 wave 1 complete (24-01 and 24-02 both shipped); awaiting orchestrator phase-close
Current phase: 24 (Neon-Exit Closeout)
Current plan: 24-01 ✓ shipped (verification), 24-02 ✓ shipped (docs refresh)
Blockers: None
Deferred to v1.5: `NEONEX-VER-WORKER-LIVE-01` — 5-step Clerk-JWT probe of Workspace Worker `/api/ops/safety/*` (see 24-01-SUMMARY.md "User Setup Required"). Code-verified PASS; live-HTTP confirmation needs a browser session.

### Plan 24-01 completion (2026-05-25)

E2E safety_events API verification PASS for all 4 NEONEX-VER requirements:

- **NEONEX-VER-01:** Direct probe 200 `{ok:true}` + organic Worker write evidence (9 email rows with `employee_id`, last 2026-05-24T18:37Z) — both API-layer and full-E2E confirmed.
- **NEONEX-VER-02 / 04:** Code-verified via `apps/parrot/workers/routes/ops-safety.ts` (callStudentApi proxy + reason_label mapping + fail-soft null-return guard). Worker bindings `STUDENT_API_URL` (var) and `STUDENT_API_SECRET` (secret) both present on deployed version `93c9c1e6-...`. Live HTTP probe deferred to v1.5 (Clerk JWT required).
- **NEONEX-VER-03:** Wrong Bearer returns 401 `{error:"unauthorized"}`, student app `/healthz` still `database:true` after; Worker side fail-soft confirmed by code inspection.

Side effect (Rule 2 - missing critical): mirrored `STUDENT_API_SECRET` and `STUDENT_API_URL` into Infisical at `/internjobs-ai` env=`prod` — they were on the Worker but not in the canonical secrets store, contradicting RESEARCH.md's topology table.

No code commits (pure verification). Phase 24 probe row `8eefa4c9-2b57-4504-9080-f33bda4cf380` left in DB as live evidence for the deferred v1.5 Worker probe.

Summary: `.planning/milestones/v1.4-pilot-readiness/phases/24-neon-exit-closeout/24-01-SUMMARY.md`

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

| Plan | Objective | Wave | Deps | Status |
|------|-----------|------|------|--------|
| 24-01 | E2E safety_events API verification + negative tests (NEONEX-VER-01..04) | 1 | none | ✓ Shipped 2026-05-25 (live Worker JWT probe deferred to v1.5) |
| 24-02 | Docs refresh — HANDOFF.md, ROADMAP.md, infisical-project memory (NEONEX-DOC-01..03) | 1 | none | ✓ Shipped 2026-05-25 |

Both plans were wave 1 and independent — executed in parallel by two
executor contexts. 24-01 was verification work (curl probes against live
prod); 24-02 was docs-only. Phase 24 ready for orchestrator close.

## 24-01 verification artifacts (for 24-02 docs cite-back if needed)

- Parrot Worker version live in prod: `93c9c1e6-71db-40db-a73a-8e93dad27185` (deployed 2026-05-21T19:14, no re-deploys).
- Student app `INTERNAL_API_SECRET` Fly digest: `6a3910702a318b0e`; canonical value in Infisical at `/internjobs-ai` env=`prod`.
- Infisical now also contains `STUDENT_API_SECRET` and `STUDENT_API_URL` (added by 24-01 as a Rule 2 fix; RESEARCH.md topology table is now reality-aligned).
- Organic E2E evidence: 9 email-channel safety_events rows with `employee_id` set, most recent at 2026-05-24T18:37:14Z (Worker write path confirmed on the current deployment).
- Phase 24 verification probe row id (still in DB): `8eefa4c9-2b57-4504-9080-f33bda4cf380`, preview "Phase 24 verification probe", created 2026-05-25T17:31:27Z, `reviewed=false`. This row is what the deferred v1.5 Worker probe should see in `/api/ops/safety`.

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
