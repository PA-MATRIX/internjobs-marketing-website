---
phase: 27-polish-test-floor
plan: 01
subsystem: api
tags: [hono, react-query, cloudflare-durable-objects, daily-co, dates, parrot, agentic-inbox]

# Dependency graph
requires:
  - phase: 10-parrot-employee-workspace
    provides: EmployeeMailboxDO.updateEmail() + EmailPanel/InboxPane shell
provides:
  - "PATCH /api/inbox/messages/:id route (star/read toggle HTTP surface)"
  - "api.patchMessage client helper"
  - "Live EmailPanel star toggle (optimistic + cache invalidation)"
  - "Removal of all three @deprecated formatQuotedDate re-export aliases"
  - "Parrot README note documenting Daily.co theme is dashboard-only"
affects: [parrot-inbox, agentic-inbox-compose, daily-co-meetings]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "set-state-during-render derived-state sync for per-message star state (React-sanctioned pattern, avoids useEffect)"
    - "Optimistic UI update + revert-on-error for star toggle"

key-files:
  created: []
  modified:
    - apps/parrot/workers/index.ts
    - apps/parrot/app/components/EmailPanel.tsx
    - apps/parrot/app/lib/api.ts
    - apps/parrot/workers/lib/email-helpers.ts
    - apps/parrot/README.md
    - apps/agentic-inbox/workers/lib/email-helpers.ts
    - apps/agentic-inbox/app/lib/utils.ts
    - apps/agentic-inbox/app/hooks/useComposeForm.ts

key-decisions:
  - "DATES-01: did NOT create packages/shared/src/dates.ts — both apps are excluded from root workspaces so @internjobs/shared is unresolvable. Goal (remove deprecated aliases) fully met without it."
  - "DAILY-THEME-01: no code path exists for Daily.co theming (plain iframe embed, no DailyIframe.createFrame). Theme is dashboard-only; documented in README, handed to human checkpoint."

patterns-established:
  - "Star toggle: optimistic local state + queryClient.invalidateQueries(['parrot','inbox']) on success, revert on error"

# Metrics
duration: ~20min
completed: 2026-06-03
---

# Phase 27 Plan 01: Polish — Star API, Dates Cleanup, Daily Theme Note Summary

**STAR-API-01 wires a live Parrot inbox star toggle (PATCH route + api.patchMessage + optimistic EmailPanel button); DATES-01 deletes all three @deprecated formatQuotedDate aliases and migrates callers; DAILY-THEME-01 documented as dashboard-only (no code path) and handed to a human checkpoint.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-06-03
- **Tasks:** 2 of 3 fully complete via code; 1 checkpoint (DAILY-THEME-01) awaiting human dashboard verification
- **Files modified:** 8

## Accomplishments

- **STAR-API-01 (complete):**
  - `PATCH /api/inbox/messages/:id` route added in `apps/parrot/workers/index.ts` — validates body has `starred` or `read`, calls `EmployeeMailboxDO.updateEmail()`, returns `{id, starred, read}`; 400 on empty body, 404 when email not found.
  - `api.patchMessage(id, { starred?, read? })` helper added to `apps/parrot/app/lib/api.ts`.
  - `EmailPanel.tsx` star button is now a live toggle: optimistic `starred` state, `api.patchMessage` on click, `queryClient.invalidateQueries(["parrot","inbox"])` on success, revert on error. `disabled` and the "coming soon" TODO removed.
- **DATES-01 (complete):**
  - Deleted `formatEmailDate` alias from both `apps/parrot/workers/lib/email-helpers.ts` and `apps/agentic-inbox/workers/lib/email-helpers.ts`; both internal callers now call `formatQuotedDate` directly.
  - Deleted `formatComposeDate` alias from `apps/agentic-inbox/app/lib/utils.ts`; `buildQuotedReplyBlock` now calls `formatQuotedDate` directly (import retained — still used).
  - `apps/agentic-inbox/app/hooks/useComposeForm.ts` now imports `formatQuotedDate` from `"shared/dates"` directly and uses it in `buildForwardBody`; `formatComposeDate` removed from the `~/lib/utils` import.
  - `grep -rn "formatComposeDate" apps/` returns zero matches. `formatEmailDate` no longer exists as an export/call (only two historical narrative comments remain; the stale parrot comment was trimmed).
  - Per the REVISED plan, `packages/shared/src/dates.ts` was NOT created (would be an orphan — apps are excluded from root workspaces).
- **DAILY-THEME-01 (doc + checkpoint):** Added a "Meetings (Daily.co theme)" section to `apps/parrot/README.md` stating the theme is dashboard-only with no code path, including the exact console.daily.co steps and the Campus Aurora palette values.

## Task Commits

NOT committed by executor (sandbox has no git). The orchestrator must stage the file list below individually and commit. Suggested split:
1. **Task 1: STAR-API-01** — `feat(27-01): wire star-toggle PATCH route + live EmailPanel button` (workers/index.ts, app/lib/api.ts, app/components/EmailPanel.tsx)
2. **Task 2: DATES-01** — `refactor(27-01): delete 3 deprecated formatQuotedDate re-exports, migrate callers` (4 dates files)
3. **DAILY-THEME-01 note** — `docs(27-01): document Daily.co theme is dashboard-only` (apps/parrot/README.md)

## Files Created/Modified

- `apps/parrot/workers/index.ts` — Added `PATCH /api/inbox/messages/:id` route (STAR-API-01).
- `apps/parrot/app/lib/api.ts` — Added `api.patchMessage` helper.
- `apps/parrot/app/components/EmailPanel.tsx` — Live star toggle (added `useState`/`useQueryClient` imports, derived star state, `handleStar`, removed `disabled`).
- `apps/parrot/workers/lib/email-helpers.ts` — Deleted `formatEmailDate` alias; caller uses `formatQuotedDate`; trimmed stale comment.
- `apps/agentic-inbox/workers/lib/email-helpers.ts` — Deleted `formatEmailDate` alias; caller uses `formatQuotedDate`.
- `apps/agentic-inbox/app/lib/utils.ts` — Deleted `formatComposeDate` alias; `buildQuotedReplyBlock` uses `formatQuotedDate`.
- `apps/agentic-inbox/app/hooks/useComposeForm.ts` — Direct `formatQuotedDate` import from `shared/dates`; removed `formatComposeDate`.
- `apps/parrot/README.md` — Added Meetings/Daily.co theme dashboard-only note.

## Decisions Made

- **packages/shared/src/dates.ts NOT created.** Followed the plan's REVISED scope: `!apps/parrot` and `!apps/agentic-inbox` are excluded from root npm workspaces, so `@internjobs/shared` cannot resolve from within them. The app-local `"shared/dates"` (resolved via each app's `baseUrl: "."`) is the canonical copy and was left untouched. Removing the three deprecated aliases fully satisfies DATES-01.
- **EmailPanel star state uses the set-state-during-render pattern** (guarded by `starredEmailId !== emailId`) to keep all hooks above the early returns while syncing the local star state to the loaded message. This is the React-sanctioned alternative to a `useEffect` for derived state.
- **DAILY-THEME-01 has no code path.** MeetingsPane embeds Daily.co as a plain `<iframe src>` with no `DailyIframe.createFrame`/`theme` config, so theming must be done in console.daily.co. Documented in README; actual dashboard application + iframe verification handed to a human checkpoint.

## Deviations from Plan

### Minor cleanup beyond the literal steps

**1. [Rule 1 - Hygiene] Trimmed stale `formatEmailDate` reference in a Parrot comment**
- **Found during:** Task 2
- **Issue:** `apps/parrot/workers/lib/email-helpers.ts` line 17 listed `formatEmailDate` in a backfill-history comment after the symbol was deleted.
- **Fix:** Removed `formatEmailDate` from the comment list so the narrative stays accurate.
- **Files modified:** apps/parrot/workers/lib/email-helpers.ts
- **Verification:** `grep formatEmailDate` now returns only the dates.ts JSDoc narrative comment (harmless, in a different file).

---

**Total deviations:** 1 (cosmetic comment cleanup). **Impact:** None on behavior; no scope creep.

## Issues Encountered

- **Sandbox has no git, npm, or node.** All edits made via Edit/Write only. `npm run typecheck` and `npm test` could not be run here — **verification deferred to the orchestrator** (run `npm run typecheck` in both `apps/parrot/` and `apps/agentic-inbox/`).

## User Setup Required

**External service configuration required for DAILY-THEME-01 (dashboard-only, no code path).** In `console.daily.co`:
- "internjobs" domain → Rooms → Default room settings → Appearance
- Accent color `#7C3AED`, background `#FAFAFA`, text/border palette "slate"
- Save domain-level defaults (applies to all rooms including `parrot-*`)

## Next Phase Readiness

- STAR-API-01 and DATES-01 are code-complete and ready for typecheck/test verification by the orchestrator.
- **Blocker for full phase closure:** DAILY-THEME-01 requires a human to apply the Campus Aurora palette in console.daily.co and visually confirm it in the `/meetings` iframe. This is a `checkpoint:human-verify` and cannot be done by the executor.

---
*Phase: 27-polish-test-floor*
*Completed: 2026-06-03*
