---
phase: 11-dailyco-integration
verified: 2026-05-19T00:00:00Z
status: human_needed
score: 14/14 must-haves verified
human_verification:
  - test: "With DAILY_API_KEY set in Worker secrets, click 'Start Meeting' from Inbox or Chat pane"
    expected: "A new Daily.co room tab opens AND the Parrot tab navigates to /meetings"
    why_human: "window.open() + navigate() requires a live browser session against a deployed Worker with DAILY_API_KEY provisioned"
  - test: "Navigate to /meetings → Your room tab while signed in as an employee"
    expected: "An embedded Daily.co prebuilt UI loads in the iframe (camera/mic/screenshare visible) after the room is provisioned"
    why_human: "DailyProvider + iframe rendering requires a real browser session; room URL can only be exercised after DAILY_API_KEY is wrangler-pushed"
  - test: "Click 'Start Meeting' without DAILY_API_KEY set"
    expected: "The Phase 13 slate-800 toast appears ('Meetings coming soon...') with no navigation, no crash"
    why_human: "Fallback path depends on runtime env var state; needs a real browser session to verify toast renders"
  - test: "POST /api/dev/smoke/dailyco with DAILY_API_KEY set (PARROT_DEV_MODE=true)"
    expected: "{ pass: true, get_ok: true, delete_ok: true }"
    why_human: "Requires live Daily.co API key and deployed Worker"
  - test: "POST /api/dev/smoke/dailyco-token with DAILY_API_KEY set"
    expected: "{ pass: true, token_minted: true }"
    why_human: "Requires live Daily.co API key"
---

# Phase 11: Daily.co Integration Verification Report

**Phase Goal:** Daily.co account + REST + JS SDK embed in Parrot's Meetings pane. Per-employee always-on personal rooms. "Start meeting" CTAs from Inbox + Chat.
**Verified:** 2026-05-19
**Status:** human_needed
**Re-verification:** No — initial verification

## Architectural Context Loaded

- Locked source: `.planning/milestones/v1.2-two-sided-agent-mvp/phase-11-dailyco-integration/11-01-PLAN.md` — "DAILY_API_KEY is a Worker secret — code must fail soft when unset"; "Personal rooms: `parrot-{clerk_user_id}` always-on, no `exp`"; "Ephemeral StartMeeting rooms: `parrot-meet-{uuid8}`, `exp = now + 3600`"
- Locked source: `ROADMAP.md` — Phase 11 description confirms "@daily-co/daily-react + @daily-co/daily-js packages installed (reversal of original forbidden list)" and "Migrations 6 (meetings_rooms) + 7 (meeting_started event_type) on EmployeeMailboxDO"
- No prior VERIFICATION.md found — initial verification.

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                         | Status     | Evidence |
| -- | --------------------------------------------------------------------------------------------- | ---------- | -------- |
| 1  | DAILY_API_KEY declared as optional in types.ts (Omit list + Env interface) + documented in wrangler.jsonc | ✓ VERIFIED | `types.ts` line 50 (Omit tuple) + line 141 (`DAILY_API_KEY?: string`); `wrangler.jsonc` lines 103-108 |
| 2  | `daily.ts` exports `createRoom`, `getRoom`, `deleteRoom`, `getMeetingToken` — all fail-soft when DAILY_API_KEY absent | ✓ VERIFIED | All four functions present in `/workers/lib/daily.ts` (202 lines). `dailyFetch()` returns `null` immediately when `!apiKey`. No throws anywhere. |
| 3  | `getActiveRooms()` also present in `daily.ts` (Wave 2) | ✓ VERIFIED | Lines 192-202 of `daily.ts` |
| 4  | Migration `6_meetings_rooms` adds `personal_room_name` + `personal_room_url` to profile | ✓ VERIFIED | `migrations.ts` lines 252-256: `ALTER TABLE profile ADD COLUMN personal_room_name TEXT; ALTER TABLE profile ADD COLUMN personal_room_url TEXT;` |
| 5  | Migration `7_meeting_started_event_type` rebuilds notifications table with `'meeting_started'` in CHECK constraint | ✓ VERIFIED | `migrations.ts` lines 275-290: table-rebuild pattern with `CHECK (event_type IN ('urgent_todo','starred_email','chat_mention','meeting_started'))` + index recreation |
| 6  | `EmployeeMailboxDO.ensurePersonalRoom(apiKey)` exists — lazy-provisions personal room, persists URL, idempotent | ✓ VERIFIED | `durableObject/index.ts` line 1315 — full implementation with idempotency check, deterministic name `parrot-{employee_id}`, fail-soft on null room |
| 7  | `EmployeeMailboxDO.getPersonalRoom()` read-only accessor (Wave 2) | ✓ VERIFIED | `durableObject/index.ts` line 1383 |
| 8  | `EmployeeMailboxDO.startEphemeralMeeting(apiKey)` creates ephemeral `parrot-meet-{uuid8}` room with `exp=now+3600`; falls back to Phase 13 behavior | ✓ VERIFIED | `durableObject/index.ts` line 1423 — `parrot-meet-${crypto.randomUUID().slice(0,8)}`, exp computation, fail-soft Phase 13 audit row preserved |
| 9  | `POST /api/meetings/ensure-room` registered; `GET /api/meetings/my-room` + `GET /api/meetings/room-token` + `GET /api/meetings/active` all registered | ✓ VERIFIED | `workers/index.ts` lines 464, 488, 508, 529 respectively |
| 10 | `POST /api/dev/smoke/dailyco` and `POST /api/dev/smoke/dailyco-token` PARROT_DEV_MODE-gated; return `{pass:bool}` | ✓ VERIFIED | `workers/index.ts` lines 1069 + 549; both gate on `!c.env.PARROT_DEV_MODE` returning 403; both return `{pass:false}` (not 5xx) when key absent |
| 11 | `@daily-co/daily-react` + `@daily-co/daily-js` in `apps/parrot/package.json` | ✓ VERIFIED | `package.json` lines 19-20: `"@daily-co/daily-js": "^0.87.0"` and `"@daily-co/daily-react": "^0.25.2"` |
| 12 | `/meetings` route rebuilt with three-tab secondary nav (Your room / Active rooms / History) | ✓ VERIFIED | `app/routes/meetings.tsx` (63 lines): `SecondaryNavItem` for each tab; `?tab=` search param; renders `<MeetingsPane activeTab={tab} />` |
| 13 | `MeetingsPane.tsx` wraps with `<DailyProvider>`, renders iframe, has graceful fallback, Active rooms + History tabs | ✓ VERIFIED | `app/components/MeetingsPane.tsx` (312 lines): `DailyProvider` imported + used (8 occurrences); fallback card "Your room is being set up"; all 3 tab subcomponents present |
| 14 | `StartMeeting.tsx` upgraded — opens `window.open(url)` + `navigate('/meetings')` on real-room success; Phase 13 toast on fallback; no `@daily-co` import | ✓ VERIFIED | `app/components/crosspane/StartMeeting.tsx` (65 lines): `window.open` line 32, `useNavigate` line 17, `meetings_coming_soon` check line 36; zero `@daily-co` imports |
| 15 | `POST /api/crosspane/start-meeting` calls `startEphemeralMeeting()`, returns `{ok:true, url}` on success / fallback shape on failure | ✓ VERIFIED | `workers/index.ts` lines 644-671: handler delegates to `c.var.mailboxStub.startEphemeralMeeting(c.env.DAILY_API_KEY)` |
| 16 | No `api.cloudflare.com/.../ai/run/` URLs introduced | ✓ VERIFIED | `grep -rn` across all `apps/parrot/**/*.ts{,x}` returns zero hits |
| 17 | "Phase 11 pending" seam title completely removed from codebase | ✓ VERIFIED | `grep -c "Phase 11 pending"` across `workers/index.ts` + `durableObject/index.ts` returns 0 |
| 18 | `OnboardingWizard` step 3 links to personal room URL (or `/meetings` fallback) | ✓ VERIFIED | `OnboardingWizard.tsx` lines 101-111 + 295-300: `useQuery` on `api.getMyRoom()`; `personalRoomUrl` uses room URL or `/meetings`; "Open my room →" button present |
| 19 | TypeScript clean | ✓ VERIFIED | `cd apps/parrot && npx tsc --noEmit` exits 0 with zero errors (the pre-existing OnboardingWizard error documented in Waves 1+2 has since been resolved) |

**Score:** All 14 structural must-haves verified (19 sub-truths checked, all pass). Status is `human_needed` because live browser + DAILY_API_KEY provisioning cannot be verified programmatically.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `apps/parrot/workers/lib/daily.ts` | REST client: createRoom, getRoom, deleteRoom, getMeetingToken, getActiveRooms | ✓ VERIFIED | 202 lines; all 5 functions exported; `dailyFetch` fail-soft core; no npm dep |
| `apps/parrot/workers/durableObject/migrations.ts` | Migration 6_meetings_rooms + 7_meeting_started_event_type | ✓ VERIFIED | Both migrations present with correct SQL |
| `apps/parrot/workers/types.ts` | DAILY_API_KEY optional in Env + Omit list | ✓ VERIFIED | 4 references (Omit tuple + field + doc comments) |
| `apps/parrot/wrangler.jsonc` | DAILY_API_KEY secret comment block | ✓ VERIFIED | Lines 103-108 with Infisical path + fail-soft note |
| `apps/parrot/workers/index.ts` | /api/meetings/ensure-room, /my-room, /room-token, /active + smoke endpoints | ✓ VERIFIED | All 6 routes registered |
| `apps/parrot/workers/durableObject/index.ts` | ensurePersonalRoom + getPersonalRoom + startEphemeralMeeting methods | ✓ VERIFIED | All 3 at lines 1315, 1383, 1423 |
| `apps/parrot/app/routes/meetings.tsx` | 3-tab secondary nav + MeetingsPane render | ✓ VERIFIED | 63 lines; all 3 tabs; WorkspaceShell wrapper |
| `apps/parrot/app/components/MeetingsPane.tsx` | DailyProvider + iframe embed + 3 tab components + graceful fallback | ✓ VERIFIED | 312 lines; substantive; DailyProvider wired |
| `apps/parrot/app/components/crosspane/StartMeeting.tsx` | window.open + navigate on success; Phase 13 toast fallback; no @daily-co import | ✓ VERIFIED | 65 lines; all three behaviors present |
| `apps/parrot/app/lib/api.ts` | ensurePersonalRoom, getMyRoom, getRoomToken, getActiveRooms, crosspaneStartMeeting (widened) | ✓ VERIFIED | All 5 helpers present |
| `apps/parrot/package.json` | @daily-co/daily-js + @daily-co/daily-react | ✓ VERIFIED | Lines 19-20 |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `POST /api/meetings/ensure-room` | `EmployeeMailboxDO.ensurePersonalRoom()` | `requireEmployeeMailbox` + `c.var.mailboxStub.ensurePersonalRoom(c.env.DAILY_API_KEY)` | ✓ WIRED | `workers/index.ts` line 469 |
| `ensurePersonalRoom()` | `daily.ts createRoom()` | passes `apiKey`; returns null when absent | ✓ WIRED | `durableObject/index.ts` line 1350 |
| `POST /api/crosspane/start-meeting` | `EmployeeMailboxDO.startEphemeralMeeting()` | `c.var.mailboxStub.startEphemeralMeeting(c.env.DAILY_API_KEY)` | ✓ WIRED | `workers/index.ts` line 657 |
| `startEphemeralMeeting()` | `daily.ts createRoom()` with `{ exp }` | existing import from Wave 1 | ✓ WIRED | `durableObject/index.ts` line 1441 |
| `MeetingsPane (YourRoomTab)` | `GET /api/meetings/my-room` + `POST /api/meetings/ensure-room` | `useQuery` + `api.getMyRoom()` → 404 chain → `api.ensurePersonalRoom()` | ✓ WIRED | `MeetingsPane.tsx` lines 54-79 |
| `DailyProvider` | personal room URL | `url={roomUrl} token={token}` props | ✓ WIRED | `MeetingsPane.tsx` line 133 |
| `StartMeeting.tsx` | `POST /api/crosspane/start-meeting` | `api.crosspaneStartMeeting()` via `useMutation` | ✓ WIRED | `StartMeeting.tsx` line 25 |
| `StartMeeting` component | `InboxPane` + `ChatPane` | imported + rendered in both | ✓ WIRED | `InboxPane.tsx` line 12+142; `ChatPane.tsx` line 20+45 |
| `GET /api/meetings/my-room` | `EmployeeMailboxDO.getPersonalRoom()` | `requireEmployeeMailbox` + `c.var.mailboxStub.getPersonalRoom()` | ✓ WIRED | `workers/index.ts` line 491 |
| `GET /api/meetings/room-token` | `daily.ts getMeetingToken()` | `getMeetingToken(c.env.DAILY_API_KEY, ...)` | ✓ WIRED | `workers/index.ts` line 514 |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `apps/parrot/workers/index.ts` | 595-598 | Stale comment above `email-to-chat` block describes `start-meeting` as a Phase 11 UI seam that "does NOT call Daily.co" — now outdated since Wave 3 upgraded the handler | Warning | None — runtime behavior is correct; comment misleads future readers of the surrounding `email-to-chat` / `chat-to-email` / `start-meeting` block header |

### Security Pass (gstack Pass 1 — CRITICAL)

All `sql.exec()` calls in phase-modified files use the parameterized `sql.exec(sqlString, ...params)` form. No string interpolation of user-controlled data into SQL query strings found. No `eval()`, no `new Function()`, no shell exec calls. `daily.ts` does not pass LLM-provided URLs to `fetch()` — URLs are constructed from the hardcoded `DAILY_BASE = "https://api.daily.co/v1"` constant plus a static path. No new `api.cloudflare.com/.../ai/run/` URLs introduced.

Security Pass: No Pass 1 issues found in phase-modified files.

### Human Verification Required

#### 1. StartMeeting CTA — Real Daily.co Path

**Test:** With `DAILY_API_KEY` provisioned via `wrangler secret put DAILY_API_KEY --cwd apps/parrot`, click "Start Meeting" from either the Inbox pane or the Chat pane while signed in to workspace.internjobs.ai.
**Expected:** A new browser tab opens with the Daily.co prebuilt room UI; the Parrot browser tab navigates to the `/meetings` route. No toast shown.
**Why human:** `window.open()` + `navigate('/meetings')` requires a live browser session against a deployed Worker with `DAILY_API_KEY` set.

#### 2. Meetings Pane — Your Room Tab Embed

**Test:** Navigate to `/meetings` (or `/meetings?tab=your-room`) while signed in.
**Expected:** After a brief loading spinner, the Daily.co prebuilt UI (camera, microphone, chat, screenshare controls) renders in the iframe. The room name slug (`parrot-<clerk_user_id>`) appears in the pane header. Subsequent navigations to the tab skip provisioning (idempotent).
**Why human:** DailyProvider + iframe rendering requires a live browser with an already-provisioned room and `DAILY_API_KEY` in the Worker.

#### 3. Meetings Pane — Fallback State (no DAILY_API_KEY)

**Test:** With `DAILY_API_KEY` absent from Worker secrets, load `/meetings?tab=your-room`.
**Expected:** The "Your room is being set up — Room provisioning is in progress, check back in a moment" fallback card renders. No JavaScript error, no crash.
**Why human:** Fallback rendering depends on runtime env var state.

#### 4. Start Meeting — Fallback Toast (no DAILY_API_KEY)

**Test:** With `DAILY_API_KEY` absent, click "Start Meeting" in Inbox or Chat pane.
**Expected:** Phase 13 toast ("Meetings coming soon — Daily.co integration is on the roadmap.") appears at the bottom of the screen for ~3.5 seconds. No navigation. No error.
**Why human:** Toast visibility requires live browser session.

#### 5. Smoke Endpoints (with DAILY_API_KEY)

**Test:** `curl -X POST https://workspace.internjobs.ai/api/dev/smoke/dailyco` (requires PARROT_DEV_MODE=true)
**Expected:** `{ "pass": true, "get_ok": true, "delete_ok": true }`
**Test:** `curl -X POST https://workspace.internjobs.ai/api/dev/smoke/dailyco-token`
**Expected:** `{ "pass": true, "token_minted": true }`
**Why human:** Both require a live Daily.co API key and deployed Worker.

### Summary

All 14 structural must-haves are verified in the codebase:

- `daily.ts` REST helper (202 lines) with all required exports + fail-soft contract.
- Migrations 6 and 7 are present with correct SQL (nullable ALTER for profile columns; table-rebuild for notifications CHECK constraint).
- All three EmployeeMailboxDO methods (`ensurePersonalRoom`, `getPersonalRoom`, `startEphemeralMeeting`) exist with correct signatures and behavior.
- All 6 Worker routes registered (`/api/meetings/ensure-room`, `/my-room`, `/room-token`, `/active`, and both smoke endpoints).
- `@daily-co/daily-{js,react}` installed; `MeetingsPane.tsx` uses `DailyProvider`; 3-tab nav complete.
- `StartMeeting.tsx` upgraded to real-room path; Phase 13 fallback intact; no `@daily-co` import.
- `POST /api/crosspane/start-meeting` fully upgraded to call `startEphemeralMeeting()`.
- All "Phase 11 pending" seam references removed.
- TypeScript exits 0 (fully clean, no errors).

The sole blocking gate for live behavior is **DAILY_API_KEY provisioning** — a user-action item documented in all three SUMMARY files. Code is structurally complete and correctly wired. Five human verification items require a deployed Worker + Daily.co key.

One stale comment at `workers/index.ts:595-598` describes the `start-meeting` handler using pre-Wave-3 language; runtime is correct, but the comment should be updated in a future cleanup pass.

---

_Verified: 2026-05-19_
_Verifier: Claude (rrr-verifier)_
