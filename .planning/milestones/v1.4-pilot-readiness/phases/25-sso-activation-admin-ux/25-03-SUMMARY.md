---
phase: 25-sso-activation-admin-ux
plan: "25-03"
subsystem: infra
tags: [dependency-cleanup, neon-exit, package-json, npm, workspace-worker]

# Dependency graph
requires:
  - phase: v1.3-neon-exit
    provides: "Migrated student app from Neon to Fly Postgres; left @neondatabase/serverless as orphan in apps/parrot/"
provides:
  - "Clean apps/parrot/package.json with no orphan @neondatabase/serverless dep"
  - "Updated package-lock.json reflecting npm uninstall"
  - "Closure of NEONEX-DEP-01 requirement"
affects: [v1.4-pilot-readiness, future-supply-chain-audits]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic dependency removal verified via grep workers/ + npm run build"

key-files:
  created:
    - .planning/milestones/v1.4-pilot-readiness/phases/25-sso-activation-admin-ux/25-03-SUMMARY.md
  modified:
    - apps/parrot/package.json
    - apps/parrot/package-lock.json

key-decisions:
  - "Transitive peerDep references inside drizzle-orm are acceptable — drizzle advertises optional support for multiple DB drivers; we just don't install them"
  - "Verification gate is grep workers/ + npm run build, not raw package-lock.json grep count"

patterns-established:
  - "Orphan-dep removal: confirm zero source imports first, then npm uninstall, then re-grep + build verify"

# Metrics
duration: 3min
completed: 2026-05-26
---

# Phase 25 Plan 03: Drop Orphan @neondatabase/serverless Dep Summary

**Removed the dangling `@neondatabase/serverless` dependency from `apps/parrot/` — Neon-exit (v1.3) leftover with zero imports in worker source.**

## Performance

- **Duration:** ~3 min (uninstall + build dominated)
- **Started:** 2026-05-26T16:52:05Z
- **Completed:** 2026-05-26T16:54:55Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- `@neondatabase/serverless` removed from `apps/parrot/package.json` direct dependencies
- `apps/parrot/package-lock.json` updated via `npm uninstall` (`removed 1 package`)
- Verified zero source imports in `apps/parrot/workers/**` (pre-existing condition confirmed)
- `npm run build` passes (client bundle 13.76s, SSR bundle 9.77s — both green)
- NEONEX-DEP-01 requirement closed

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove @neondatabase/serverless and verify build** — `ebe3822` (chore)

**Plan metadata:** (this SUMMARY + STATE update) — committed separately as docs commit.

## Files Created/Modified

- `apps/parrot/package.json` — Removed `"@neondatabase/serverless": "^1.1.0"` from dependencies block
- `apps/parrot/package-lock.json` — npm uninstall reconciled lock file (removed direct entry + node_modules references; 2 transitive optional peerDep references inside drizzle-orm remain and are intentional)

## Decisions Made

- **Transitive peerDep hits are acceptable.** `package-lock.json` retains 2 references to `@neondatabase/serverless` inside `drizzle-orm`'s `peerDependencies` and `peerDependenciesMeta`. Both are marked `optional: true` — drizzle advertises optional support for Neon as one of several DB drivers, but no actual install resolution occurs. The critical gate (zero workers/ imports + absent from direct deps + build passes) is satisfied.
- **No `npm audit fix` run.** The uninstall output reported 6 pre-existing vulnerabilities (4 moderate, 2 high) unrelated to this removal. Audit hygiene is out of scope for plan 25-03; deferred to a dedicated security plan if needed.

## Deviations from Plan

None — plan executed exactly as written. Pre-condition grep (Step 2) confirmed zero imports before uninstall; post-condition grep (Step 4) and build (Step 5) confirmed clean removal.

## Issues Encountered

None. Single-command uninstall + single-command build, both succeeded on first try.

## User Setup Required

None — no external service configuration changed. Pure local package manifest cleanup.

## Next Phase Readiness

- Phase 25 Wave 1 plans status:
  - **25-01** (mmctl SSO runbook) — deferred pending operator credentials (per STATE.md)
  - **25-02** (admin UX brand refit) — in progress on this branch (unstaged `admin.tsx` change observed during commit)
  - **25-03** (this plan) — closed, NEONEX-DEP-01 done
- No blockers introduced. Next operator action: complete 25-02 brand refit or schedule 25-01 SSO activation window.
- Supply chain note: 6 npm audit findings (4 moderate, 2 high) pre-exist and warrant a follow-up plan, but are out of scope here.

---
*Phase: 25-sso-activation-admin-ux*
*Completed: 2026-05-26*
