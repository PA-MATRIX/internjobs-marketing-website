---
phase: 30-parrot-email-pane-parity
plan: "03"
subsystem: ui
tags: [parrot, react, react-query, react-router, lucide, email-pane, toast, undo]

# Dependency graph
requires:
  - phase: 30-01
    provides: "POST /api/inbox/messages/:id/move, two-stage DELETE /api/inbox/messages/:id, GET /api/inbox/messages?folder=starred"
provides:
  - "api.moveMessage(id, folder) + api.deleteMessage(id) client helpers"
  - "EmailPanel Archive + Delete toolbar buttons with onActioned callback"
  - "InboxPane archive/delete flow: selection clear + React Query invalidation + inline toast with Undo"
  - "Starred virtual folder: sidebar nav entry + FOLDERS passthrough + folderTitle case"
affects: [parrot-email-pane, parrot-inbox]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Prefix-match React Query invalidation (queryKey ['parrot','inbox'], exact:false) cascades to folder lists + per-message caches in one call"
    - "Child→parent action callback (onActioned) lets EmailPanel report archive/delete so InboxPane owns selection clear + toast"
    - "Inline absolutely-positioned toast overlay (no external toast lib) with optional Undo that reverses the last move"

key-files:
  created: []
  modified:
    - apps/parrot/app/lib/api.ts
    - apps/parrot/app/components/EmailPanel.tsx
    - apps/parrot/app/components/InboxPane.tsx
    - apps/parrot/app/routes/inbox.tsx

key-decisions:
  - "Undo reverses archive/move-to-trash via api.moveMessage(previousId, previousFolder); hard-deletes render no Undo button (irreversible)"
  - "Toast lives inside the list pane (relative container) and auto-dismisses after 4s; selectedId is cleared first so EmailPanel unmounts before the list refetches"

patterns-established:
  - "onActioned callback pattern: leaf action component reports outcome string, parent owns side-effects (invalidation + toast)"

# Metrics
duration: 14min
completed: 2026-06-18
---

# Phase 30 Plan 03: Parrot Email-Pane Actions (Archive/Delete/Undo + Starred) Summary

**Archive + Delete buttons in the EmailPanel toolbar wired to move/two-stage-delete routes, with an inline Undo toast and a Starred virtual folder in the inbox sidebar — all refreshing via prefix-match React Query invalidation without a full page reload.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-06-18T00:30Z
- **Completed:** 2026-06-18T00:40Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `api.moveMessage(id, folder)` and `api.deleteMessage(id)` client helpers point at the Wave 1 routes; deleteMessage surfaces the two-stage `{movedToTrash}` / `{hardDeleted}` discriminant.
- EmailPanel toolbar gained Archive and Delete buttons (alongside the existing Reply/Forward/Star) plus an `onActioned` callback so the parent owns post-action side-effects.
- InboxPane implements the full feedback loop: clear selection → prefix-match invalidate (`["parrot","inbox"]` cascades to folder lists + message caches) → inline toast with Undo. Archive / move-to-trash are undoable (re-move to the source folder); hard-delete shows "Deleted permanently" with no Undo.
- Starred virtual folder: `Star` nav entry below Trash, `"starred"` added to the FOLDERS set so it isn't normalized to inbox, and `folderTitle` returns "Starred".

## Task Commits

Each task was committed atomically:

1. **Task 1: api helpers + Starred nav + folderTitle case** - `41f23b9` (feat)
2. **Task 2: Archive/Delete buttons + toast+Undo flow** - `133329c` (feat)

**Plan metadata:** see final `docs(30-03)` commit.

## Files Created/Modified
- `apps/parrot/app/lib/api.ts` - Added `moveMessage` and `deleteMessage` to the `api` object after `patchMessage`.
- `apps/parrot/app/routes/inbox.tsx` - Imported `Star`, added `"starred"` to FOLDERS, added the Starred `SecondaryNavItem` below Trash.
- `apps/parrot/app/components/InboxPane.tsx` - `folderTitle` "starred" case (Task 1); `ToastState` interface, toast state + `showToast` + `handleActioned`, `onActioned` wired to EmailPanel, `relative` on list pane, inline toast overlay (Task 2).
- `apps/parrot/app/components/EmailPanel.tsx` - `Archive`/`Trash2` imports, `onActioned` prop, `handleArchive`/`handleDelete` handlers, Archive + Delete toolbar buttons after Forward.

## Decisions Made
- Undo reverses the last move via `api.moveMessage(previousId, previousFolder)` then re-invalidates; hard-deletes are irreversible so no Undo button is rendered.
- Single prefix-match invalidation (`{ queryKey: ["parrot","inbox"] }`, exact:false default) refreshes both folder lists and per-message caches without enumerating sub-keys.
- Star toggle was intentionally NOT touched — it already shipped in Phase 27 (per plan/key facts).

## Deviations from Plan
None - plan executed exactly as written. The diff at each commit matched the plan's `files_modified` frontmatter (no extra files touched).

## Issues Encountered
- A stale `.git/index.lock` blocked the Task 2 stage; removed it (`rm -f .git/index.lock`) and re-staged. No content impact.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Track 1 (email actions: star [pre-existing], archive, delete, toast+undo, Starred view) of Phase 30 is complete end-to-end.
- `npm run typecheck` green; `vitest run` 10/10 passing in apps/parrot.
- Visual/Chrome verification of the toast + Undo flow is deferred to the operator window (Clerk prod keys are domain-locked, blocking local visual verify per workstream notes).

---
*Phase: 30-parrot-email-pane-parity*
*Completed: 2026-06-18*
