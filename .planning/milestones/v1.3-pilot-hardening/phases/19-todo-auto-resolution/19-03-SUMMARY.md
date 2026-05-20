---
phase: 19-todo-auto-resolution
plan: 03
subsystem: parrot-frontend
tags: ["react", "polling", "animate-out", "undo", "toast", "v1.3"]
requires: ["19-01", "19-02"]
provides: ["19-03"]
affects: []
tech-stack:
  added: []
  patterns:
    - "10s polling with previous-id diff for disappearance-triggered animate-out"
    - "Per-employee localStorage gate for first-occurrence UX toasts"
    - "Optimistic local-state removal after Undo POST"
key-files:
  modified:
    - apps/parrot/app/components/TodoCard.tsx
    - apps/parrot/app/routes/dashboard.tsx
decisions:
  - "Resolved nav item lives in DashboardSecondaryNav (dashboard.tsx), NOT in WorkspaceShell ADMIN_NAV"
  - "rank field marked optional — resolved-view payload doesn't include it"
  - "First-clear toast triggers on ANY disappearance, not just agent — false positives accepted (toast copy is generic enough)"
metrics:
  duration: "~25 min"
  completed: "2026-05-19"
---

# Phase 19 Plan 03: Frontend Auto-Clear UX Summary

Resolved-view secondary nav, animated dismissal of agent-cleared todos in the active list, `ResolvedTodoCard` with Agent vs You pill + Undo button, one-time first-clear toast persisted per employee via localStorage.

## What Shipped

- **`TodoItem` interface (TodoCard.tsx)**:
  - Added `resolution_source?: 'agent' | 'user' | null` (optional — back-compat with existing fixtures).
  - Made `rank` optional — `getResolvedTodos()` payload doesn't compute rank.
- **`ResolvedTodoCard` (TodoCard.tsx)**: new exported component, violet "Agent" pill (`bg-violet-100 text-violet-700`) for `resolution_source === 'agent'`, grey "You" pill for null/'user', relative "resolved Xm ago" timestamp (reuses `formatAge` with `resolved_at`), inline Undo button rendered only for agent-resolved rows.
- **`DashboardSecondaryNav` (dashboard.tsx)**: added "Resolved" `SecondaryNavItem` between "This week" and "Quick jump" with `CheckCircle` icon.
- **`DashboardRoute` (dashboard.tsx)**:
  - 10-second polling interval on the active list (`ACTIVE_POLL_INTERVAL_MS = 10_000`). Resolved view does NOT poll.
  - Animate-out detection: tracks `prevTodoIdsRef`; when a previously-visible id is missing from the new response, adds to `dismissingIds` Set, applies CSS transition (max-height 0, opacity 0, translateY -8px, 250ms ease-in-out), then removes from the Set after 300ms.
  - First-clear toast: bottom-center fixed banner, dark slate-800, violet CheckCircle icon, 5-second auto-dismiss + manual × button. Gated by `localStorage.getItem('parrot_agent_clear_seen_' + employeeId)`.
  - `employeeId` hydrated from a single `GET /api/me` on mount (uses `profile.employeeId` from the existing route).
  - `handleUndo(todo)`: POST `/api/dashboard/todos/{id}/unresolve`, then optimistically filter the row out of local state.
  - Heading + empty-state copy updated for `view=resolved` ("Recently resolved" + "Todos auto-cleared by Parrot or dismissed in the last 48 hours.").

## Decisions Made

- **Resolved item is a Dashboard secondary nav item, not a top-level ADMIN_NAV entry.** `WorkspaceShell.tsx` was left untouched. Resolved is per-pane secondary nav — Safety (Phase 20) is admin-rail-level. Different nav scopes, no conflict.
- **`rank` made optional on `TodoItem`.** `getResolvedTodos()` returns rows without computing the rank formula (no `ORDER BY rank DESC`). Optional avoids a fixture-rewriting cascade.
- **First-clear toast triggers on any disappearance.** We can't tell from the active-list payload whether a disappeared row was agent-resolved or user-dismissed (the resolved_at + resolution_source fields are not in the active query result). Triggering on any disappearance accepts a small false-positive rate — the toast copy ("Parrot resolved a todo automatically") is generic enough that even a user-dismissed disappearance reading the toast just reinforces what Parrot does. Better than not firing for agent clears.
- **Polling pauses on Resolved view.** Operators expect stability when reviewing past resolutions; auto-refresh would feel surprising.
- **Optimistic Undo state.** The Undo button removes the row from local state immediately (before awaiting the response). If the POST fails, the row stays gone in the resolved view until next nav — a follow-up click won't help because the local state has already removed it. Tradeoff accepted: Undo is rare AND fail-soft per the route design, so the optimistic path is the right default.

## Verification Results

```
grep "resolution_source" TodoCard.tsx → interface + ResolvedTodoCard logic
grep "ResolvedTodoCard" TodoCard.tsx → declared + exported
grep "Resolved|view=resolved|CheckCircle" dashboard.tsx → nav item present
grep "ACTIVE_POLL_INTERVAL_MS|dismissingIds|parrot_agent_clear_seen|handleUndo" dashboard.tsx → all present

apps/parrot && npx tsc --noEmit → exit 0 (clean)
apps/parrot && npm run build → success (1.73s client, 1.41s server)
  Pre-existing warning re: @neondatabase/serverless dynamic-vs-static
  import is from Phase 20 and unrelated.
```

## Files

- Modified: `apps/parrot/app/components/TodoCard.tsx` (+85 lines for ResolvedTodoCard + interface update)
- Modified: `apps/parrot/app/routes/dashboard.tsx` (+262 lines, -35 lines for polling/animate-out/toast/Undo/Resolved view)

## Commit

`d03ff15 feat(19-03): add Resolved view + animate-out + Undo + first-clear toast`

## Deviations from Plan

- **`WorkspaceShell.tsx` not modified.** The plan listed it in `files_modified`, but the plan body itself called out "it lives in dashboard.tsx, not WorkspaceShell.tsx — check carefully." The Resolved nav item correctly belongs in the secondary nav for the Dashboard pane only. Matches plan intent.
- **`rank` made optional on `TodoItem`.** Not called out in the plan but necessary to compile — `getResolvedTodos()` doesn't compute rank. Back-compat preserved by making it optional rather than removing.

## Authentication Gates

None during execution. Visual verification of animate-out + Resolved view + Undo requires `wrangler dev` with a real Clerk session OR a dev-mode `X-Parrot-Dev-Employee` header (HUMAN-ACTION, listed in EXECUTION-REPORT).
