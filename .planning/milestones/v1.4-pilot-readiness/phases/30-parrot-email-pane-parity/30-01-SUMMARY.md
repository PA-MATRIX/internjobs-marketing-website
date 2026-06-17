---
phase: 30-parrot-email-pane-parity
plan: "01"
subsystem: api
tags: [parrot, durable-object, hono, drizzle, inbox, email-actions]

# Dependency graph
requires:
  - phase: 27-parrot-workspace
    provides: "STAR-API-01 PATCH /api/inbox/messages/:id seam + EmployeeMailboxDO updateEmail/moveEmail/deleteEmail/getEmails/countEmails"
provides:
  - "DO getEmails/countEmails starred cross-folder filter (starred?: boolean)"
  - "GET /api/inbox/messages?folder=starred virtual-folder passthrough"
  - "POST /api/inbox/messages/:id/move (move to target folder)"
  - "DELETE /api/inbox/messages/:id two-stage trash (soft move then hard delete)"
affects: [30-03-client-wiring, 30-05-smoke-tests, parrot-email-actions-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-folder virtual view via boolean filter option applied independently of folder condition"
    - "Two-stage delete: single getEmail() read drives soft-vs-hard branch; response field (movedToTrash|hardDeleted) signals client toast"

key-files:
  created: []
  modified:
    - apps/parrot/workers/durableObject/index.ts
    - apps/parrot/workers/index.ts

key-decisions:
  - "Starred filter applied independently of folder (caller passes only one); cross-folder by design"
  - "DELETE branches on email.folder_id === Folders.TRASH using one getEmail() read; no getEmails round-trip"

patterns-established:
  - "Virtual folder (starred) routed through filter option, not folder-table lookup"
  - "Action response fields distinguish recoverable (movedToTrash) vs permanent (hardDeleted) for client UX"

# Metrics
duration: ~8min
completed: 2026-06-18
---

# Phase 30 Plan 01: Parrot Email-Pane Server Actions Summary

**Wired the DO starred cross-folder filter into getEmails/countEmails and added POST .../move plus a two-stage DELETE route so the EmailPanel Archive/Delete buttons and Starred sidebar view have server endpoints.**

## Performance

- **Duration:** ~8 min
- **Completed:** 2026-06-18
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `GetEmailsOptions.starred?: boolean` added; `getEmails` applies `WHERE starred = 1` independently of the folder condition, and `countEmails` appends the parameterless `starred = 1` literal (safe with `?N` indexing).
- `GET /api/inbox/messages?folder=starred` now routes to the starred filter instead of failing a folder lookup.
- `POST /api/inbox/messages/:id/move` moves a message to a target folder (`{folder}` body), 404 on unknown id/folder.
- `DELETE /api/inbox/messages/:id` is two-stage: hard-deletes when already in Trash (`{hardDeleted:true}`), otherwise moves to Trash (`{movedToTrash:true}`), using a single `getEmail()` read.

## Task Commits

1. **Task 1: Add starred filter to GetEmailsOptions, getEmails, countEmails** - `c69ec50` (feat)
2. **Task 2: folder=starred passthrough + POST .../move + DELETE two-stage** - `5a0ce12` (feat)

## Files Created/Modified
- `apps/parrot/workers/durableObject/index.ts` - starred filter in `GetEmailsOptions`, `getEmails`, `countEmails`
- `apps/parrot/workers/index.ts` - starred passthrough in GET handler; new `/move` and `DELETE` routes

## Decisions Made
- None beyond the plan. Starred filter applied independently of folder (cross-folder virtual view); two-stage delete uses one `getEmail()` read and distinguishes `movedToTrash` vs `hardDeleted` in the response. Both as specified by the plan.

## Deviations from Plan

None - plan executed exactly as written.

The plan's verify step 3 (worry that `getEmail`'s return type might not declare `folder_id`) required no action: `getEmail` returns the full `.select()` row, so `folder_id` is already typed as `string`, and `email.folder_id === Folders.TRASH` compiled with no cast (typecheck exit 0).

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Server capabilities for Starred view, Archive (move), and Delete are live. Plan 03 (client wiring in `app/lib/api.ts` + EmailPanel/InboxPane/inbox.tsx) and Plan 05 (smoke tests) can build on these.
- Verification: `npm run typecheck` (exit 0) and `npm test` (10/10 passing) from `apps/parrot/`.

---
*Phase: 30-parrot-email-pane-parity*
*Completed: 2026-06-18*
