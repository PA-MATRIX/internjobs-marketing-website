---
phase: 31-native-chat-client-build-out
plan: "02"
subsystem: chat
tags: [mattermost, channels, threads, pat, cloudflare-workers, react, react-query]

# Dependency graph
requires:
  - phase: 31-01
    provides: per-employee MM PAT (WorkspaceDO migration 3_mm_tokens) + mmFetchAsUser (401 re-mint) + resolveEmployeeToken
provides:
  - Worker channel CRUD routes — GET/POST /api/chat/channels, POST /api/chat/channels/:id/join (all as employee PAT)
  - Worker thread routes — GET/POST /api/chat/posts/:id/thread (reply sets root_id)
  - Worker message-mutation routes — PATCH/DELETE /api/chat/posts/:id (author-gated), POST /api/chat/channels/:id/pin
  - mattermost.ts helpers — createMmChannel, joinMmChannel, editMmPost, deleteMmPost, pinMmPost, getMmPostThread, getMmPost, getMmTeamPublicChannels
  - ChatPane channel browser in the WorkspaceShell secondaryNav rail + create-channel dialog + right-side thread panel + per-message action row (Reply/Edit/Delete/Pin)
affects:
  - 31-03 DMs (reuse chatUserProxy + the secondaryNav rail pattern for DM list)
  - 31-04 files/search/reactions/@mentions (message action row + thread panel are the surfaces these hang off)
  - 31-05 WebSocket real-time (channel list + thread panel become WS-driven; has_unreads dot becomes live)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "chatUserProxy(c) helper: one place to build the mmFetchAsUser closure (admin token + getToken/setToken callbacks) per request — every Wave-1 route proxies AS the employee, preserving the 401 re-mint"
    - "ChatPane owns the WorkspaceShell wrap so it can feed its live channel list into the shell's secondaryNav prop (Column 2 rail), matching the Email-folders pattern from CONTEXT.md"
    - "root_id replies filtered out of the main channel feed and shown only in the thread panel"

key-files:
  created:
    - apps/parrot/workers/tests/lib/mattermost-channels.test.ts
  modified:
    - apps/parrot/workers/lib/mattermost.ts
    - apps/parrot/workers/index.ts
    - apps/parrot/app/components/ChatPane.tsx
    - apps/parrot/app/routes/chat.tsx

key-decisions:
  - "Worker routes proxy via mmFetchAsUser (inline) rather than calling the new createMmChannel/editMmPost/... helpers directly — the helpers take a raw token and would bypass the 401 re-mint/retry path. The helpers are still exported (must_haves contract) and unit-tested; the routes get resilience. Net: helpers exist + covered, routes stay self-healing."
  - "Edit/Delete are author-gated server-side (fetch the post, compare user_id to the requester's mm_user_id from the PAT row) AND client-side (action buttons only on own posts) — defense in depth."
  - "Private-channel creation gated by hasOperatorAccess in the Worker route; the dialog also disables the Private toggle for non-operators (isOperator prop from chat.tsx via /api/me role)."
  - "Pin uses POST /api/v4/posts/{id}/pin (the post-resource pin endpoint), not the channels/posts/pin variant in the plan prose — the route surface is still POST /api/chat/channels/:id/pin with { post_id } as specified."

patterns-established:
  - "chatUserProxy(c) → { adminToken, getToken, call<T>(path, init) } — reusable per-request employee-PAT proxy for all future chat REST routes"
  - "Thread panel = right-side 320px <aside> inside the chat content flex row (messages shrink, panel fills right) — not a modal, not the full-browser drawer"

# Metrics
duration: 7min
completed: 2026-06-19
---

# Phase 31 Plan 02: Channels + Threads Summary

**ChatPane is now a usable team chat surface: a full channel browser in the Workspace secondary-nav rail (with create + join), a right-side thread panel for replies, and per-message edit/delete/pin — all backed by new Worker routes that act AS the real employee via the Wave 0 PAT, never the parrot bot.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-06-19T14:28:56Z
- **Completed:** 2026-06-19T14:35:32Z
- **Tasks:** 2 of 2
- **Files modified:** 4 (+1 test file)

## Accomplishments

- **8 new Worker routes** in `index.ts`, all proxied AS the employee through a new `chatUserProxy(c)` helper (admin token + `resolveEmployeeToken`/`setEmployeeToken` callbacks → `mmFetchAsUser`, so the 401 re-mint/retry from Wave 0 is preserved on every call):
  - `GET /api/chat/channels` — list the team's channels
  - `POST /api/chat/channels` — create (public open to all; private operator-gated)
  - `POST /api/chat/channels/:id/join` — idempotent self-join (400 already-member → success)
  - `GET /api/chat/posts/:id/thread` — full thread
  - `POST /api/chat/posts/:id/thread` — reply (resolves the root's channel, sets `root_id`)
  - `PATCH /api/chat/posts/:id` — edit, author-gated
  - `DELETE /api/chat/posts/:id` — delete, author-gated
  - `POST /api/chat/channels/:id/pin` — pin `{ post_id }`
- **8 new `mattermost.ts` helpers** (`createMmChannel`, `joinMmChannel`, `editMmPost`, `deleteMmPost`, `pinMmPost`, `getMmPostThread`, `getMmPost`, `getMmTeamPublicChannels`) with **14 unit tests**.
- **ChatPane** expanded: renders `WorkspaceShell` itself and feeds a live channel browser into the `secondaryNav` rail (# public / lock private icons, active highlight, `has_unreads` dot placeholder for Wave 4); create-channel dialog with auto-slugified name + public/private selector; right-side 320px thread panel (parent + replies, reply composer); per-message hover action row (Reply / Pin / Edit + Delete on own posts, with delete confirm + optimistic cache removal); `reply_count` badge on root posts; `root_id` replies filtered out of the main feed.
- **chat.tsx** simplified to resolve the operator role (`/api/me`) and pass `isOperator` to ChatPane (gates private-channel creation in the dialog).

## Task Commits

Each task was committed atomically:

1. **Task 1: Worker routes for channel CRUD + thread ops** - `5173867` (feat)
2. **Task 2: ChatPane channel browser, create dialog, thread panel, message actions** - `cd3b660` (feat)

**Plan metadata:** `<this commit>` (docs: complete plan)

## Files Created/Modified

- `apps/parrot/workers/lib/mattermost.ts` — added createMmChannel, joinMmChannel, editMmPost, deleteMmPost, pinMmPost, getMmPostThread, getMmPost, getMmTeamPublicChannels (all take a bearer token directly).
- `apps/parrot/workers/index.ts` — `chatUserProxy(c)` helper + 8 new `/api/chat/*` routes (channel CRUD, join, thread GET/POST, post PATCH/DELETE, pin); author-gating on edit/delete; operator-gating on private channel create.
- `apps/parrot/app/components/ChatPane.tsx` — channel browser in secondaryNav, CreateChannelDialog, ThreadPanel, message action row, edit-in-place, reply_count badge (820 lines).
- `apps/parrot/app/routes/chat.tsx` — resolves operator role, passes `isOperator` to ChatPane (ChatPane now owns the WorkspaceShell wrap).
- `apps/parrot/workers/tests/lib/mattermost-channels.test.ts` — 14 unit tests for the new helpers.

## Verification

- `npx tsc -b` in apps/parrot: **zero errors** (run twice — after Task 1 and after Task 2).
- `npx react-router build`: **succeeds** (client + SSR bundles built; chat-B394jyzG.js 26.28 kB gzip 7.15 kB).
- `npx vitest run`: **29 tests pass across 8 files** (14 new channel/thread-helper tests + 15 existing, zero regressions).
- `npm run typecheck` (the package script) NOT run in full — it chains `cf-typegen` (wrangler) + `react-router typegen` which can touch network/codegen in this sandbox; the meaningful compile signal (`tsc -b`) and the real `react-router build` were both run directly and are clean. Same posture as plan 31-01.
- Browser `chrome_visual_check` / Playwright from the plan's `verification.surface` (ui_affecting) were NOT executed in this sandbox — no live MM instance with `MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true` and no browser/Clerk prod session. The build proving the component tree compiles + renders, plus the helper unit tests, are the substitute. Live visual verification is deferred to plan 31-06 UAT (consistent with the phase's deploy gate).

## Deviations from Plan

### Helpers exported but routes proxy inline (design choice, not a gap)
The plan's Task 1 says routes use `resolveEmployeeToken` + the new helpers. The new `createMmChannel`/`editMmPost`/etc. helpers take a **raw token** and would bypass the Wave 0 401 re-mint/retry. So the routes instead call `mmFetchAsUser` directly (via `chatUserProxy`) to keep self-healing PATs, while the helpers are still **exported** (satisfying the must_haves `exports` contract) and covered by 14 unit tests. Both goals met; the routes are strictly more resilient.

### Pin endpoint path (Rule 1 — correctness)
Plan prose mentioned `POST /api/v4/channels/{channelId}/posts/pin`. Mattermost v4 pins a post via the **post resource**: `POST /api/v4/posts/{id}/pin`. The helper + route use the correct MM endpoint. The Parrot-facing route surface is unchanged (`POST /api/chat/channels/:id/pin` with `{ post_id }`, as the plan specifies).

### ChatPane owns WorkspaceShell (layout wiring)
The plan said "chat.tsx renders ChatPane with secondary nav extracted and passed to WorkspaceShell." Because the channel list + active-channel state live inside ChatPane, the clean wiring is for **ChatPane to render `<WorkspaceShell secondaryNav={channelList}>` itself** and chat.tsx to just supply the `isOperator` flag. Same end state (channel browser in Column 2), fewer prop-drilling seams.

### Extra file (beyond frontmatter files_modified)
- `apps/parrot/workers/tests/lib/mattermost-channels.test.ts` — added to satisfy the plan's `unit_tests` verification step and cover the 8 new helpers. Pure new test coverage.

## Production Gate / Deferred

- All channel/thread/edit operations depend on the employee PAT, which requires `MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true` on the internjobs-mattermost Fly app — **deferred to plan 31-06 Task 1**. Until then `resolveEmployeeToken` returns null and these routes return `503 chat_not_provisioned`; the ChatPane surfaces the friendly reason copy.
- No production deploy / `wrangler deploy` was performed (per critical-environment note + the CLOUDFLARE_ACCOUNT_ID no-op gotcha). Code + commits + tests only.

## Notes for Next Plan

- **Reuse `chatUserProxy(c)`** for every future chat REST route (DMs in 31-03, files/search/reactions in 31-04) — it is the single source for the employee-PAT proxy closure.
- The `has_unreads` field on `MmChannel` is a wired placeholder (dot renders only when true); Wave 4/5 should populate it from real unread counts (and/or the WebSocket).
- The thread panel + per-message action row are the natural mount points for reactions, @mention rendering, and file attachments in 31-04.
- Repo layout reminder: live git repo is the nested `internjobs-marketing-website/` (branch `rrr/v1.4/team-workspace-31`); the outer `Internjobs cms` dir is a separate empty repo.
