---
phase: 31-native-chat-client-build-out
plan: "05"
subsystem: chat
tags: [mattermost, websocket, real-time, presence, typing, notifications, cloudflare-workers, durable-objects, react]

# Dependency graph
requires:
  - phase: 31-01
    provides: per-employee MM PAT (WorkspaceDO 3_mm_tokens) + getEmployeeToken + mmFetchAsUser/resolveEmployeeToken
  - phase: 31-02
    provides: chatUserProxy(c) employee-PAT proxy helper + ChatPane channel browser + /api/chat/posts
  - phase: 31-03
    provides: DM/group channels as first-class surfaces + /api/chat/team-members roster + relaxed membership gates
  - phase: 31-04
    provides: ChatPane rich content (files/search/reactions/@mentions) + the 5s post-poll that this wave replaces
provides:
  - Worker-proxied WebSocket — workers/lib/mm-ws-proxy.ts handleChatWebSocket; PAT sent in MM authentication_challenge UPSTREAM ONLY (never reaches the browser); server.accept() with no args
  - /api/chat/ws WebSocket upgrade route, /api/chat/presence (bot status/ids), POST /api/chat/channels/:id/mark-read (employee-PAT view)
  - DO migration 9_last_seen (ALTER profile ADD last_seen_at) + EmployeeMailboxDO.touchLastSeen + requireEmployeeMailbox waitUntil wiring
  - EmployeeMailboxDO alarm offline-detection (last_seen >5min + unread chat_mention) → sendOfflineChatNotification (email-sender.ts)
  - ChatPane real-time — useChatWebSocket hook (replaces polling), typing indicators, DM presence dots, unread channel/DM dots, mark-read on switch
  - WorkspaceShell Chat nav unread badge driven by window 'chat-unread-change' CustomEvent
affects:
  - 31-06 hardening/UAT (live WS + PAT-in-frames DevTools verify, nginx WS-upgrade resolution, CHAT-RT-04 alarm email UAT, MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true on Fly)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Worker-proxied WebSocket via WebSocketPair + Response{status:101, webSocket}; server.accept() takes NO args in the CF runtime; authentication_challenge is sent on the UPSTREAM socket directly (never relayed from the browser's server socket) so the PAT cannot leak downstream"
    - "WS URL derived from MATTERMOST_URL (https→wss) with a MATTERMOST_WS_URL escape hatch for when the nginx proxy at chat.internjobs.ai can't pass Upgrade: websocket (open question from 31-RESEARCH Q3, resolved in 31-06 prep)"
    - "useChatWebSocket holds callbacks in a ref (cbRef) so socket handlers always see fresh closures WITHOUT re-subscribing the socket on every render; activeIdRef lets stable callbacks read the current channel"
    - "posted WS event appends to the React Query cache via setQueryData (dedupe by post.id) instead of refetching — instant render, zero extra request"
    - "Offline-detection: last_seen_at touched fire-and-forget via c.executionCtx.waitUntil on every authenticated request; the 2-min DO alarm compares it to now-5min + unread chat_mention count, with a DO-KV high-water mark so a stationary backlog doesn't re-email every cycle"

key-files:
  created:
    - apps/parrot/workers/lib/mm-ws-proxy.ts
    - apps/parrot/workers/tests/lib/chat-realtime.test.ts
  modified:
    - apps/parrot/workers/index.ts
    - apps/parrot/workers/lib/email-sender.ts
    - apps/parrot/workers/durableObject/migrations.ts
    - apps/parrot/workers/lib/mailbox.ts
    - apps/parrot/workers/durableObject/index.ts
    - apps/parrot/app/components/ChatPane.tsx
    - apps/parrot/app/components/WorkspaceShell.tsx

key-decisions:
  - "touchLastSeen() + the alarm offline-email check live in workers/durableObject/index.ts (where EmployeeMailboxDO is actually defined), NOT workspace.ts as the frontmatter listed — WorkspaceDO is a different singleton DO that has no per-employee profile/notifications/alarm. The plan's own action text said 'in workspace.ts or wherever EmployeeMailboxDO is defined — read the file to locate'."
  - "DO code uses this.ctx.storage.sql.exec (the established pattern), not the plan snippet's this.db.exec/this.db.prepare (which don't exist on this DO's drizzle handle for raw SQL the way the snippet assumed)."
  - "mark-read uses the correct MM v4 endpoint POST /api/v4/channels/members/{user_id}/view with body {channel_id}, not the plan's /api/v4/channels/{channelId}/members/{uid}/view (that path shape isn't the MM view endpoint)."
  - "Offline-email de-dupe via a DO-KV high-water mark (offline_chat_notified_count), reset on touchLastSeen — only re-emails when the unread-mention count GROWS, so the 2-min alarm doesn't spam while the employee stays away."
  - "DM presence dots resolve the partner NAME (DMs carry dm_partner_names, not partner ids) against the team-member roster's status — best-effort, shown only on 1:1 (type D) DMs when resolvable."

patterns-established:
  - "Real-time delivery replaces polling: postsQuery keeps its one-shot initial fetch (enabled on channel switch) but the refetchInterval is gone; live posts arrive via the posted WS event into the query cache."
  - "Cross-component badge via window CustomEvent: ChatPane dispatches chat-unread-change; WorkspaceShell listens and renders the Chat-icon badge — no shared store, works across panes."
  - "WS reconnect uses exponential backoff (2→4→8→16s, cap 30s) with a closedByUnmount guard so intentional unmounts don't reconnect."

# Metrics
duration: 9min
completed: 2026-06-19
---

# Phase 31 Plan 05: Real-time + Notifications Summary

**Chat goes real-time: a Worker-proxied WebSocket at /api/chat/ws (employee PAT authenticated server-side, never exposed to the browser) replaces the 5s polling, with live typing indicators, DM presence dots, real-time unread channel/DM badges + a Chat nav-icon badge, and an offline @mention/DM email fired by the EmployeeMailboxDO alarm when the Workspace tab has been closed for 5+ minutes.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-06-19T15:00:41Z
- **Completed:** 2026-06-19T15:09:36Z
- **Tasks:** 3 of 3
- **Files modified:** 7 (+2 created: 1 lib, 1 test)

## Accomplishments

- **`workers/lib/mm-ws-proxy.ts` (`handleChatWebSocket`)** — opens a `WebSocketPair`, dials MM's `/api/v4/websocket`, and on upstream `open` sends the MM `authentication_challenge` with the employee PAT **to the upstream socket only**. The browser's socket only ever receives MM response frames, so the PAT is structurally unable to leak downstream. `server.accept()` is called with no arguments (CF runtime requirement); returns `new Response(null, {status:101, webSocket: client})`. Returns 426 for non-upgrade requests and 503 `chat_not_provisioned` when the employee has no stored PAT.
- **Three new Worker routes** in `index.ts` (all `requireEmployeeMailbox`):
  - `GET /api/chat/ws` — the upgrade endpoint.
  - `GET /api/chat/presence?ids=…` — batched `POST /api/v4/users/status/ids` (bot token), returns `[{user_id,status}]`, cached 15s.
  - `POST /api/chat/channels/:id/mark-read` — `POST /api/v4/channels/members/{mmUserId}/view` body `{channel_id}` AS the employee (clears MM unread tracking).
- **Offline @mention/DM email (CHAT-RT-04)** — migration `9_last_seen` (`ALTER TABLE profile ADD last_seen_at`); `EmployeeMailboxDO.touchLastSeen()` called fire-and-forget from `requireEmployeeMailbox` via `c.executionCtx.waitUntil`; the DO alarm's new `maybeSendOfflineChatEmail()` checks `last_seen_at < now-5min` + unread `chat_mention` count and calls `sendOfflineChatNotification(env, email, count)` (added to `email-sender.ts`, fail-soft, with a workspace-chat link).
- **ChatPane real-time** — `useChatWebSocket` hook connects to `/api/chat/ws`, dispatches `posted`/`typing`/`status_change`/`channel_viewed`, reconnects with exponential backoff; the 5s `refetchInterval` is removed and the `posted` event appends to the query cache. Typing indicator (debounced `user_typing` emit, 3s prune, animated dots), presence dots on 1:1 DM rows, unread dots on channels/DMs, mark-read fired on channel switch, and a `chat-unread-change` window event.
- **WorkspaceShell** — listens for `chat-unread-change` and shows a red count badge on the Chat nav icon when unread > 0 and the chat pane isn't active.

## Task Commits

1. **Task 1: WS proxy + presence/mark-read routes + offline mention email** — `6a90df9` (feat)
2. **Task 2: ChatPane WebSocket real-time, typing, presence, unread badges** — `71292dc` (feat)
3. **Task 3: WorkspaceShell chat-unread nav badge** — `02b1788` (feat)

**Plan metadata:** `<this commit>` (docs: complete plan)

## Files Created/Modified

- `apps/parrot/workers/lib/mm-ws-proxy.ts` *(created)* — Worker-proxied WS bridge; PAT in upstream `authentication_challenge` only.
- `apps/parrot/workers/tests/lib/chat-realtime.test.ts` *(created)* — 6 unit tests: WS 426/503 guards + `sendOfflineChatNotification` (missing binding, singular/plural subject + workspace link, fail-soft on throw).
- `apps/parrot/workers/index.ts` — import `handleChatWebSocket`; `/api/chat/ws`, `/api/chat/presence`, `POST /api/chat/channels/:id/mark-read` routes.
- `apps/parrot/workers/lib/email-sender.ts` — `sendOfflineChatNotification(env, email, mentionCount)` (fail-soft, singular/plural subject, text + html with workspace link).
- `apps/parrot/workers/durableObject/migrations.ts` — migration `9_last_seen`.
- `apps/parrot/workers/lib/mailbox.ts` — `requireEmployeeMailbox` calls `stub.touchLastSeen()` via `c.executionCtx.waitUntil` (fire-and-forget, try/catch for test contexts).
- `apps/parrot/workers/durableObject/index.ts` — `touchLastSeen()` (+ resets the offline-email watermark), `maybeSendOfflineChatEmail()`, alarm wired to call it; imports `sendOfflineChatNotification`.
- `apps/parrot/app/components/ChatPane.tsx` *(now ~2330 lines)* — `useChatWebSocket` hook, real-time state (typing/presence/unread), presence/typing/unread UI, mark-read + `chat-unread-change` dispatch; removed the 5s poll.
- `apps/parrot/app/components/WorkspaceShell.tsx` — `chat-unread-change` listener + Chat-icon unread badge.

## Decisions Made

See the `key-decisions` frontmatter. Highlights: DO logic placed in `durableObject/index.ts` (real `EmployeeMailboxDO` location, not `workspace.ts`); raw `ctx.storage.sql.exec` (not the snippet's `this.db.prepare`); correct MM v4 mark-read endpoint; KV high-water-mark offline-email de-dupe; name-resolved DM presence dots.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] DO method placed in `durableObject/index.ts`, not `workspace.ts`**
- **Found during:** Task 1
- **Issue:** The frontmatter `files_modified` and the action snippet referenced `workspace.ts` for `touchLastSeen` + the alarm offline-email check. But `EmployeeMailboxDO` (which owns `profile`, `notifications`, and the `alarm()` handler) lives in `workers/durableObject/index.ts`; `workspace.ts` defines a *different* singleton `WorkspaceDO` with no profile/alarm. Adding the methods to `workspace.ts` would not have compiled against the data they need.
- **Fix:** Added `touchLastSeen()`, `maybeSendOfflineChatEmail()`, and the alarm wiring to `durableObject/index.ts`. The plan's action text explicitly allowed this ("in workspace.ts or wherever EmployeeMailboxDO is defined — read the file to locate"). `workspace.ts` was therefore NOT modified.
- **Files modified:** `apps/parrot/workers/durableObject/index.ts`
- **Verification:** `tsc -b` clean; alarm + touchLastSeen reference real `profile`/`notifications` rows.
- **Committed in:** `6a90df9`

**2. [Rule 1 - Bug] DO SQL uses `ctx.storage.sql.exec`, not `this.db.exec`/`this.db.prepare`**
- **Found during:** Task 1
- **Issue:** The plan snippet used `this.db.exec(...)` / `this.db.prepare(...).first(...)`. This DO's `this.db` is a drizzle handle; the established raw-SQL pattern throughout the DO is `this.ctx.storage.sql.exec(...)`. The snippet as written would not match the codebase.
- **Fix:** Implemented `touchLastSeen` + the alarm check with `this.ctx.storage.sql.exec(...)`, matching every other raw query in the file.
- **Files modified:** `apps/parrot/workers/durableObject/index.ts`
- **Verification:** `tsc -b` clean; full vitest green.
- **Committed in:** `6a90df9`

**3. [Rule 1 - Bug] Corrected the MM mark-read endpoint**
- **Found during:** Task 1
- **Issue:** The plan said `POST /api/v4/channels/{channelId}/members/{uid}/view`. The actual Mattermost v4 "view channel" endpoint is `POST /api/v4/channels/members/{user_id}/view` with body `{channel_id}`.
- **Fix:** Used the correct endpoint shape.
- **Files modified:** `apps/parrot/workers/index.ts`
- **Verification:** `tsc -b` clean (live MM call deferred to 31-06 UAT — see below).
- **Committed in:** `6a90df9`

**4. [Rule 2 - Missing Critical] Offline-email de-dupe high-water mark**
- **Found during:** Task 1
- **Issue:** The plan's alarm check would re-send the offline email every 2-minute alarm tick for as long as the employee stayed away with unread mentions (spam).
- **Fix:** Store the last-notified unread count in DO KV (`offline_chat_notified_count`); only email when the count GROWS; reset the mark in `touchLastSeen` so a fresh away-period re-notifies.
- **Files modified:** `apps/parrot/workers/durableObject/index.ts`
- **Verification:** logic-reviewed; covered indirectly by the email-helper unit tests.
- **Committed in:** `6a90df9`

---

**Total deviations:** 4 auto-fixed (2 bug, 1 blocking, 1 missing-critical).
**Impact on plan:** All deviations were corrections needed to compile against the real codebase / MM API or to prevent email spam. No scope creep — every artifact and key_link in the plan's `must_haves` is delivered.

## Issues Encountered

- The WS happy-path bridge (`WebSocketPair`) can't run under node/vitest (it needs the workerd runtime), so the unit tests cover the node-runnable guard paths (426/503) + the offline-email helper. The full bidirectional bridge is validated by the production build (the route + handler compile and mount) and is the live-UAT surface for 31-06.

## CHAT-RT-04 / Production Gate (Deferred to 31-06)

- **Offline-email alarm (CHAT-RT-04):** verified by construction + unit tests, but the end-to-end "wait 5 min → alarm fires → email sends" was **NOT** triggered in this sandbox (no live DO alarm scheduler, no SMTP trap). **Deferred to 31-06 production UAT** per the plan's explicit allowance (`must_haves` truth + verification step 8). Local-trigger recipe is in the plan action (set `last_seen_at` to `-6 minutes`, fire the alarm).
- **PAT-in-frames DevTools check** (verification step 3/4) and the live real-time/typing/presence walkthrough require a browser + a live MM with `MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true` + a Clerk prod session — **deferred to 31-06 UAT**, consistent with the phase deploy gate (no deploy was performed here).
- **nginx WS-upgrade question (31-RESEARCH Q3):** unresolved here; `mm-ws-proxy.ts` supports a `MATTERMOST_WS_URL` env override to point straight at `wss://internjobs-mattermost.fly.dev` if `chat.internjobs.ai` doesn't pass `Upgrade: websocket`. Resolve + set in 31-06 prep.
- No production deploy / `wrangler deploy` performed (per critical-environment note + the `CLOUDFLARE_ACCOUNT_ID` no-op gotcha). Code + commits + `tsc -b` + `react-router build` + `vitest` only.

## Verification

- `npx tsc -b` in apps/parrot: **zero errors** (after each task).
- `npx react-router build`: **succeeds** (client + SSR; `chat-*.js` 50.90 kB / gzip 13.42 kB, up from 45.93 kB in Wave 3; `WorkspaceShell-*.js` 18.59 kB).
- `npx vitest run`: **53 tests pass across 11 files** (6 new chat-realtime tests + 47 prior, zero regressions).

## Next Phase Readiness

- Real-time stack is wired and compiles; 31-06 owns the live UAT walkthrough (PAT-never-in-frames DevTools proof, real-time/typing/presence/unread, offline-email alarm trigger) + the Fly secret (`MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true`) + the nginx WS-upgrade decision.
- Branch is chat-only (PR #13 email-pane work not merged here): `sendOfflineChatNotification` was added additively to `email-sender.ts` and uses only the existing `sendEmail` transport — no dependency on unmerged PR #13 code.

---
*Phase: 31-native-chat-client-build-out*
*Completed: 2026-06-19*
