---
phase: 31-native-chat-client-build-out
verified: 2026-06-19T15:15:00Z
status: human_needed
score: 19/24 must-haves verified (5 production-only, classified human_needed)
human_verification:
  - test: flyctl secrets list shows MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true
    expected: Secret present; MM restarted healthy
    why_human: Requires live flyctl access to internjobs-mattermost Fly app
  - test: PAT minting works -- POST /api/admin/chat/backfill-tokens returns minted > 0
    expected: Response has failed=0 and minted > 0
    why_human: Requires Fly secret active first (operator checkpoint), operator session token
  - test: ENABLEPERSONALACCESSTOKENS stray var absent from Fly MM app
    expected: No output from flyctl secrets list grep
    why_human: Requires live flyctl access
  - test: WebSocket real-time delivery -- message from Tab 2 appears in Tab 1 without 5s delay
    expected: WS connected; posted events instant; no repeated XHR for posts
    why_human: CF Workers WebSocketPair not in Vitest/Node; requires live browser and MM
  - test: PAT security -- DevTools Frames show no server-to-browser frame with employee PAT
    expected: authentication_challenge sent upstream only; PAT absent from downstream frames
    why_human: Requires live browser DevTools Frames inspection
  - test: Typing indicators show when colleague types in same channel
    expected: Name is typing... appears within 2s; clears within 3s
    why_human: Requires live multi-tab session with live MM
  - test: Presence dots visible for DM partners in DM section
    expected: Colored dots (green/yellow/gray) next to 1:1 DM partner names
    why_human: Requires live Mattermost with multiple active users
  - test: Offline email (CHAT-RT-04) fires after tab closed 5+ minutes
    expected: Email with mention count and workspace chat link
    why_human: DO alarm cannot trigger in Vitest; requires SMTP binding and real EMAIL env var
  - test: nginx WebSocket upgrade passthrough decision (31-RESEARCH Q3)
    expected: chat.internjobs.ai passes WS, OR MATTERMOST_WS_URL set to wss://internjobs-mattermost.fly.dev
    why_human: Requires live curl probe against production nginx
  - test: Full 15-step employee UAT (31-06 operator checkpoint)
    expected: All 15 steps in 31-06-PLAN.md pass in production
    why_human: Requires live Clerk auth + Fly Worker + live MM; 31-06 checkpoint is pending
---

# Phase 31: Native Chat Client Build-Out -- Verification Report

**Phase Goal:** Turn the channel-only ChatPane into a full in-app chat client: per-employee MM PATs, channels + threads, DMs + group DMs, files + search + reactions + @mentions, WebSocket real-time + offline-mention email. Mattermost-on-Fly stays source of truth; only the UI renderer + per-employee auth change.

**Verified:** 2026-06-19T15:15:00Z
**Status:** human_needed -- all code verified SUBSTANTIVE + WIRED; operator/production steps remain
**Re-verification:** No -- initial verification

## Architectural Context Loaded

- .planning/PROJECT.md -- v1.4 milestone: close v1.3 dangling work for first 5-10 startup pilots
- 31-CONTEXT.md -- locked: native forced (MM Team Edition; OIDC/SSO paid Enterprise); SecondaryNav rail; threads in right-side panel; out of scope: background push, mobile/desktop apps
- Memory native-chat-client-buildout-phase.md -- decided 2026-06-19: go NATIVE; Wave 0 = per-user MM tokens; mobile/desktop + background push out of scope
- Memory mm-oidc-sso-blocked-by-license.md -- OIDC bridge impossible without license; Fly env-var config pattern confirmed

No findings contradict locked decisions.

---

## Build + Tests

**npx tsc -b in apps/parrot:** Zero errors (exit 0, no output)

**npx vitest run in apps/parrot:**

Test Files: 14 passed (14)
Tests: 64 passed (64)
Duration: 2.86s

All 64 tests pass. 11 new Phase 31 test files all green. Zero regressions.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Per-employee MM PAT stored in WorkspaceDO | VERIFIED | workspace.ts:113 migration 3_mm_tokens; getEmployeeToken at 247; setEmployeeToken at 264 |
| 2 | Worker proxies human chat REST via employee PAT not bot token | VERIFIED | chatUserProxy(c) at index.ts:1147; all Wave 1-4 routes call proxy.call() through mmFetchAsUser |
| 3 | Human messages in MM under real employee account | VERIFIED (code) / human_needed (live) | No parrot_author_* on human post body; ChatPane hybrid renderer uses post.user_id; live verify deferred to 31-06 UAT |
| 4 | Backfill endpoint exists and is operator-gated | VERIFIED | index.ts:1784 -- POST /api/admin/chat/backfill-tokens; hasOperatorAccess gate; production backfill is human_needed |
| 5 | 401-triggered PAT re-mint | VERIFIED | mattermost.ts:556-561 -- on 401: mintMmUserToken + store + retry; covered by mattermost-pat.test.ts |
| 6 | Channel browser in secondary nav | VERIFIED | ChatPane.tsx:584 useQuery on /api/chat/channels; renders with # and lock icons; active highlight |
| 7 | Channel creation + join from UI | VERIFIED | createChannelMutation at ChatPane.tsx:900; Worker routes at index.ts:1204 and 1243 |
| 8 | Thread replies in right-side panel | VERIFIED | threadPanelPostId at ChatPane.tsx:510; ThreadPanel at 1900; GET/POST thread routes at index.ts:1267/1289; root_id at index.ts:1314 |
| 9 | Edit, delete, pin on own messages | VERIFIED | PATCH at index.ts:1327 author-gated; DELETE at 1366 author-gated; pin at 1398; ChatPane hover action row |
| 10 | DMs and group DMs via user picker | VERIFIED | 3 DM routes at index.ts:1433-1574; NewDmDialog at ChatPane.tsx:2212; openDm mutation at 934 |
| 11 | DM list in secondary nav with partner names | VERIFIED | Separate dms useQuery at ChatPane.tsx:599; dm_partner_names enriched server-side |
| 12 | File/image upload via streaming proxy | VERIFIED | chat-files.ts:52 -- body: c.req.raw.body (NO formData buffering); mounted at index.ts:1615 |
| 13 | Inline image rendering with Content-Type forwarded | VERIFIED | chat-files.ts:83-88 -- upstream Content-Type forwarded; Content-Disposition: inline; ChatPane img src /api/chat/files/:id |
| 14 | Global search across channels | VERIFIED | POST /api/chat/search at index.ts:1620; SearchPanel at ChatPane.tsx:1947; debounced 400ms |
| 15 | Emoji reactions add/remove | VERIFIED | POST /api/chat/reactions at index.ts:1649; DELETE at 1680; 20-emoji EMOJI_PICKER at ChatPane.tsx:295; reaction chips with counts |
| 16 | @mention autocomplete + highlighting | VERIFIED | renderMessageText at ChatPane.tsx:364 with mention regex; sky-600 for others, yellow bg for self; autocomplete dropdown |
| 17 | WebSocket replaces 5s polling | VERIFIED (code) / human_needed (live) | useChatWebSocket at ChatPane.tsx:411; connects wss://{host}/api/chat/ws; refetchInterval removed at 618; posted events appended to cache |
| 18 | Typing indicators | VERIFIED (code) / human_needed (live) | sendTyping via WS user_typing; typingState pruned 1s; typing text above composer |
| 19 | Unread channel badges + nav badge | VERIFIED (code) / human_needed (live) | unreadChannels Set; chat-unread-change CustomEvent; WorkspaceShell.tsx:119 listener; badge at 146 |
| 20 | Mark-read on channel switch | VERIFIED | index.ts:1747 -- POST /api/chat/channels/:id/mark-read; correct MM endpoint /api/v4/channels/members/{mmUserId}/view; fire-and-forget |
| 21 | migration 9_last_seen + touchLastSeen wired | VERIFIED | migrations.ts:332; durableObject/index.ts:213; mailbox.ts:47 -- executionCtx.waitUntil(stub.touchLastSeen()) |
| 22 | Offline @mention email infrastructure | VERIFIED (code) / human_needed (live) | maybySendOfflineChatEmail at durableObject/index.ts:1065; last_seen_at + unread chat_mention check; KV de-dupe; sendOfflineChatNotification at email-sender.ts:89; alarm at 1041 |
| 23 | Vitest route coverage for chat routes | VERIFIED | 3 new test files: chat-token (4t 75L), chat-channels (4t 65L), chat-ws (3t 53L); all 64 tests pass |
| 24 | Fly secret + production PAT minting | human_needed | 31-06 Task 1 + blocking checkpoint not yet executed |

**Code-verifiable: 19/19 VERIFIED**
**Overall: 19/24 (5 production-only = human_needed)**

---

## Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| workers/durableObject/workspace.ts | VERIFIED | 400 lines; migration 3_mm_tokens; getEmployeeToken + setEmployeeToken present |
| workers/lib/mattermost.ts | VERIFIED | 890 lines; mintMmUserToken, mmFetchAsUser, and 15 Wave 1-3 helpers all exported |
| workers/index.ts | VERIFIED | 2453 lines; 20+ /api/chat/* routes; chatFilesRoute mounted at 1615; handleChatWebSocket at 1719 |
| workers/routes/chat-files.ts | VERIFIED | 94 lines; c.req.raw.body (no formData); Content-Type forwarded on GET |
| workers/lib/mm-ws-proxy.ts | VERIFIED | 123 lines; authentication_challenge on upstream socket only at line 73; server.accept() no args at 117 |
| workers/lib/email-sender.ts | VERIFIED | 121 lines; sendOfflineChatNotification at line 89; fail-soft |
| workers/lib/mailbox.ts | VERIFIED | 68 lines; waitUntil(touchLastSeen) at line 47 |
| workers/durableObject/migrations.ts | VERIFIED | 335 lines; 9_last_seen at line 332 |
| workers/durableObject/index.ts | VERIFIED | 1834 lines; touchLastSeen at 213; maybySendOfflineChatEmail at 1065; alarm at 1041 |
| app/components/ChatPane.tsx | VERIFIED | 2539 lines (min 950 per 31-05); all features present and wired |
| app/components/WorkspaceShell.tsx | VERIFIED | 488 lines; chat-unread-change listener at 119; badge at 146 |
| app/routes/chat.tsx | VERIFIED | 19 lines; isOperator resolved and passed to ChatPane |
| workers/tests/routes/chat-token.test.ts | VERIFIED | 75 lines (min 40); 4 tests including backfill-tokens |
| workers/tests/routes/chat-channels.test.ts | VERIFIED | 65 lines (min 40); 4 tests |
| workers/tests/routes/chat-ws.test.ts | VERIFIED | 53 lines (min 30); 3 tests |

---

## Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| ChatPane POST /api/chat/posts | Worker POST /api/chat/posts | chatFetch | WIRED |
| index.ts POST /api/chat/posts | mmFetchAsUser (employee PAT) | resolveEmployeeToken at index.ts:1122 | WIRED |
| mintMmUserToken | MM POST /api/v4/users/{id}/tokens | MATTERMOST_ADMIN_TOKEN | WIRED |
| ChatPane thread panel | GET /api/chat/posts/:id/thread | threadPanelPostId state + ThreadPanel fetch | WIRED |
| ChatPane send reply | POST /api/chat/posts with root_id | root_id set at index.ts:1314 | WIRED |
| ChatPane user picker | POST /api/chat/dms/direct or /group | openDm useMutation at ChatPane.tsx:934 | WIRED |
| index.ts POST /api/chat/dms/direct | MM POST /api/v4/channels/direct | employee PAT via chatUserProxy | WIRED |
| ChatPane file attach | POST /api/chat/files | fetch() FormData; file_ids in subsequent post | WIRED |
| chat-files.ts POST | MM POST /api/v4/files | c.req.raw.body stream (no buffering) | WIRED |
| ChatPane img src | chat-files.ts GET /:fileId | /api/chat/files/:id URL | WIRED |
| chat-files.ts GET | browser renders inline | upstream Content-Type forwarded at chat-files.ts:83-88 | WIRED |
| ChatPane useChatWebSocket | /api/chat/ws WS upgrade | new WebSocket(wss://{host}/api/chat/ws) at ChatPane.tsx:427-428 | WIRED |
| mm-ws-proxy.ts | authentication_challenge upstream only | PAT on upstream socket at mm-ws-proxy.ts:73; never relayed to browser | WIRED |
| mailbox.ts requireEmployeeMailbox | EmployeeMailboxDO.touchLastSeen | c.executionCtx.waitUntil at mailbox.ts:47 | WIRED |
| EmployeeMailboxDO alarm | sendOfflineChatNotification | maybySendOfflineChatEmail at durableObject/index.ts:1041 | WIRED |

---

## Security Pass (gstack Pass 1 -- CRITICAL)

Phase-modified files checked: workspace.ts, mattermost.ts, index.ts, chat-files.ts, mm-ws-proxy.ts, email-sender.ts, mailbox.ts, migrations.ts, durableObject/index.ts, ChatPane.tsx, WorkspaceShell.tsx, chat.tsx.

| File | Line | Category | Finding | Severity | Blocks Phase |
|------|------|----------|---------|----------|--------------|
| workers/durableObject/migrations.ts | 45 | SQL and Data Safety | String interpolation in INSERT for migration name; single-quote escape at line 41; migration names are developer-defined compile-time constants not user input | Advisory | No |

MM PAT security: STRUCTURALLY ENFORCED. Employee PAT stored in WorkspaceDO; used server-side only via chatUserProxy/mmFetchAsUser; sent to MM upstream in authentication_challenge on the upstream socket only; browser-facing server socket only receives MM response frames. PAT cannot appear in any browser-observable frame by construction.

No CRITICAL Pass 1 findings on phase-modified files.

Pass 2 (INFORMATIONAL) not run. Invoke with mode: deep-review to enable.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| workers/durableObject/index.ts | 1818 | coming soon string | Info | Pre-existing meetings-feature stub; not in any chat route; no impact on Phase 31 chat goal |

Zero blockers. Zero stub patterns in Phase 31 chat-modified files.

---

## Human Verification Required

### 1. Fly Secret Activation (BLOCKING -- must precede production backfill)
**Test:** flyctl secrets set MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true --app internjobs-mattermost; then flyctl secrets list | grep ENABLEUSERACCESSTOKENS
**Expected:** Secret present; MM restarted healthy (flyctl status shows running)
**Why human:** Requires live flyctl access

### 2. Stray Env Var Cleanup
**Test:** flyctl secrets list --app internjobs-mattermost | grep ENABLEPERSONALACCESSTOKENS
**Expected:** No output
**Why human:** Requires live flyctl access

### 3. Production PAT Backfill (run ONLY after Fly secret confirmed)
**Test:** curl -X POST https://workspace.internjobs.ai/api/admin/chat/backfill-tokens with operator session header
**Expected:** Response: minted: N, skipped: M, failed: 0 -- if failed > 0, Fly secret not yet active
**Why human:** Requires operator session + live Fly Worker + live MM with PAT minting enabled

### 4. nginx WebSocket Upgrade Decision (31-RESEARCH Q3)
**Test:** curl -i --header Connection: Upgrade --header Upgrade: websocket https://chat.internjobs.ai/api/v4/websocket
**Expected:** 101 Switching Protocols (nginx passes WS -- no action), OR 400/426 (must set MATTERMOST_WS_URL=wss://internjobs-mattermost.fly.dev in Worker secrets)
**Why human:** Live network probe; code supports MATTERMOST_WS_URL override at mm-ws-proxy.ts:162

### 5. WebSocket Real-Time + PAT-in-Frames Security Verify
**Test:** Open /chat in two browser tabs. DevTools Network WS Frames. Confirm no server-to-browser frame contains employee PAT. Send message from Tab 1 -- confirm instant in Tab 2.
**Expected:** WS connected; real-time delivery; PAT absent from all downstream frames
**Why human:** CF Workers WS runtime (WebSocketPair) not available in Vitest/Node

### 6. Typing Indicators
**Test:** Type in Tab 1 composer; observe Tab 2 in same channel
**Expected:** Name is typing... within 2s; clears within 3s
**Why human:** Requires live multi-tab session with live MM

### 7. Presence Dots
**Test:** Two employees logged in; open DM section in ChatPane
**Expected:** Colored presence dots (green/yellow/gray) next to 1:1 DM partner names
**Why human:** Requires live Mattermost with multiple active users

### 8. Offline @mention Email (CHAT-RT-04)
**Test:** Close Workspace tab; have colleague @mention you; wait 6+ minutes; check email
**Expected:** Email subject: You have N unread mention(s) in your workspace chat
**Local dev recipe:** Set last_seen_at = datetime(now, -6 minutes) in employee DO profile table; trigger alarm via wrangler dev console
**Why human:** DO alarm cannot trigger in Vitest; requires SMTP binding and real EMAIL env var

### 9. Full 15-Step Employee UAT (31-06 operator checkpoint)
**Test:** Complete 15-step checklist in 31-06-PLAN.md: send message (real name), channel browse/create/join, thread reply panel, DM + group DM, file attach + inline image, search, emoji reaction, @mention autocomplete, WS real-time in 2 tabs, typing indicator, presence dot, offline email
**Expected:** All 15 steps pass in production
**Why human:** Requires live Clerk auth + Fly Parrot Worker + live MM; 31-06 operator checkpoint is pending

---

## Gaps Summary

No code gaps found. All 19 code-verifiable must-haves across plans 31-01 through 31-06 are VERIFIED. Artifacts exist, are substantive (well above minimum line counts -- ChatPane at 2539 lines vs minimum 950), and are correctly wired.

The 5 human_needed items are genuine production-infrastructure requirements explicitly called out as operator/UAT steps from the beginning of the phase (31-01 PAT gate note, 31-05 UAT deferral, 31-06 operator checkpoint). The 31-06 operator checkpoint is intentionally pending.

---

_Verified: 2026-06-19T15:15:00Z_
_Verifier: Claude (rrr-verifier)_
