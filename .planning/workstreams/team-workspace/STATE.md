---
schema_version: 1
team: "team-workspace"
milestone: "v1.4"
status: "planning"
last_activity: "2026-05-26"
---

# team-workspace Workstream State

## Source Of Truth

- GitHub issue/phase assignment owns task status.
- GitHub branch/PR owns code status.
- This file is local execution memory for RRR only.
- Root `.planning/STATE.md` is coordinator-owned in team mode — DO NOT WRITE TO IT.

## Assignment

GitHub team: @PA-MATRIX/team-workspace
Branch: rrr/v1.4/team-workspace-25 (Phase 25 per-phase branch)
Sprite: rrr-internjobs-marketing-website-v1-4-team-workspace
Phases: 23, 25, 26, 27

## Current Position

Status: Planning complete for Phase 25 — ready for execution
Current phase: 25 (SSO Activation + Admin UX)
Current plan: — (not yet started; planning just completed)
Blockers: None

## Phase 25 Plan Summary

Branch: rrr/v1.4/team-workspace-25
Phase dir: .planning/milestones/v1.4-pilot-readiness/phases/25-sso-activation-admin-ux/

| Plan | Wave | Autonomous | Objective |
|------|------|------------|-----------|
| 25-01 | 1 | false | mmctl runbook + SSO activation script (MMSSO-01, MMSSO-03 native) — deferred pending operator credentials |
| 25-02 | 1 | true | Brand-refit /admin + /admin/invite with v1.4 brand tokens (ADMIN-UX-01..04) |
| 25-03 | 1 | true | Remove @neondatabase/serverless dep (NEONEX-DEP-01) |

All 3 plans in Wave 1 — can execute in parallel (no shared file overlap: 25-01 touches test/, 25-02 touches app/routes/ + index.css, 25-03 touches package.json + package-lock.json).

## Key Decisions for Phase 25

- **Admin UX is already built** (v1.2 Phase 16): admin.tsx + admin.invite.tsx + admin-employees.ts are all fully functional. Phase 25 scope is a BRAND REFIT (CSS tokens, no logic changes) not a build.
- **MMSSO-03 is native Mattermost behavior**: when /oidc/userinfo returns the correct claims, Mattermost auto-provisions users. No code change required. Runbook explains this.
- **MMSSO-02 deferred**: live SSO test requires mmctl operator access + fly machine restart. Plan 25-01 ships runbook + script; live execution is in a separate operator window.
- **Brand token source**: BRAND-V1.md §1 — var(--lavender) background, var(--ink) text, var(--cobalt) CTA, var(--lime) active pills. Inter font via Google Fonts @import.
- **@neondatabase/serverless has zero imports in apps/parrot/workers/**: confirmed by grep. Pure package.json cleanup.

## Notes

Owns the worker-side **Workspace** app. Code paths still use `apps/parrot/` (the
worker is named `internjobs-parrot` in Cloudflare); the verbal/written reference
in planning docs is **Workspace** to avoid confusion with an unrelated, now-deleted
Neon project that was also called "parrot".
