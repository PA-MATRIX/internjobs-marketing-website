---
phase: 30-parrot-email-pane-parity
plan: "05"
subsystem: parrot-workspace
tags: [testing, vitest, smoke-tests, inbox-routes, typecheck-gate]
requires:
  - 30-01 (inbox action routes: move, two-stage delete, starred passthrough)
  - 30-02 (Agent | MCP tabs)
  - 30-03 (email-pane actions UI)
  - 30-04 (agent activity feed)
provides:
  - Vitest smoke-test floor for the three new Phase 30 backend routes
  - Final phase-wide typecheck gate (workers/ + app/)
affects:
  - Future Parrot inbox route work (regression floor in place)
tech-stack:
  added: []
  patterns:
    - "Route smoke test = import inner { app }, app.fetch() with devHeaders, assert not-404/not-500 (auth-gated 401 expected)"
key-files:
  created:
    - apps/parrot/workers/tests/routes/inbox-actions.test.ts
  modified: []
decisions:
  - "No source fixes were required: typecheck was already clean across Plans 01-04 (folder_id, starred countEmails option, emailId/FeedEntry all type-correct)."
duration: ~10m
completed: 2026-06-18
---

# Phase 30 Plan 05: Inbox-Actions Route Smoke Tests + Typecheck Gate Summary

**One-liner:** Added a 3-case vitest smoke suite (`inbox-actions.test.ts`) for the move/delete/starred routes mirroring `reply-forward.test.ts`, taking the parrot suite to 13/13 green; confirmed `npm run typecheck` exits 0 across the full workspace including all Plans 01-04 changes — no source fixes needed.

## What Shipped

- **`apps/parrot/workers/tests/routes/inbox-actions.test.ts`** — three smoke tests against the inner Hono `app`, each asserting the route is mounted and non-crashing (`not 404`, `not 500`; auth-gated 401 is the expected baseline):
  1. `POST /api/inbox/messages/:id/move` (body `{folder:"archive"}`)
  2. `DELETE /api/inbox/messages/:id` (two-stage delete entry point)
  3. `GET /api/inbox/messages?folder=starred` (cross-folder starred view)
- Pattern copied verbatim from `reply-forward.test.ts`: `{ app }` from `../../index`, `{ minimalEnv, devHeaders, mockCtx }` from `../helpers`, `app.fetch(...)`.

## Verification

- `npm test` (vitest run) in `apps/parrot/`: **13 passed (13)** across 7 files — was 10/10 before, +3 new in `inbox-actions route smoke`. No previously-green test regressed.
- `npm run typecheck` (`cf-typegen && react-router typegen && tsc -b`) in `apps/parrot/`: **exit 0**, no `error TS` across `workers/` + `app/`, including all Plans 01-04 source.

## Deviations from Plan

None — plan executed exactly as written. The plan anticipated that typecheck *might* surface type errors introduced by Plans 01-04 (missing `folder_id`, `starred` option on `countEmails`, `emailId` on `FeedEntry`, etc.) and instructed fixing them here. The baseline typecheck was already clean, so no source files needed modification; only the declared test artifact was added.

## Authentication Gates

None.

## Next Phase Readiness

- Test floor and typecheck gate for Phase 30's backend are established.
- Remaining for phase closeout: visual/functional walkthrough of the email pane (star toggle, archive/delete + toast/Undo, Starred folder view, Agent | MCP tabs, agent activity feed). No backend blockers.
