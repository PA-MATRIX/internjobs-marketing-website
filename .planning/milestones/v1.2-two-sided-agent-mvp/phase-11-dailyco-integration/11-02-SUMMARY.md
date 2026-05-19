---
schema_version: 2
phase: 11-dailyco-integration
plan: 02
type: summary
wave: 2
subsystem: parrot-ui
status: complete
completed: 2026-05-19
duration: "5m 58s"
tags:
  - daily.co
  - meetings
  - sdk
  - react
  - durable-objects
  - fail-soft
  - phase-11
requires:
  - 11-01   # daily.ts REST helper + ensurePersonalRoom + ensure-room route
  - 10-02   # EmployeeMailboxDO + profile table
  - 13-03   # OnboardingWizard (step 3 of which now links to the personal room)
provides:
  - "@daily-co/daily-js + @daily-co/daily-react in apps/parrot/package.json"
  - "GET /api/meetings/my-room — read-only personal room URL"
  - "GET /api/meetings/room-token — per-call meeting token mint (fail-soft)"
  - "GET /api/meetings/active — list of currently-active rooms"
  - "POST /api/dev/smoke/dailyco-token — PARROT_DEV_MODE token-mint probe"
  - "getActiveRooms() helper in workers/lib/daily.ts"
  - "EmployeeMailboxDO.getPersonalRoom() read-only accessor"
  - "Rebuilt Meetings pane (3 tabs: Your room / Active rooms / History) with embedded Daily.co iframe"
  - "OnboardingWizard step 3 personal-room link"
affects:
  - 11-03   # StartMeeting upgrade — same /api/meetings endpoints + same embed posture
tech-stack:
  added:
    - "@daily-co/daily-js@^0.87.0 (browser SDK)"
    - "@daily-co/daily-react@^0.25.2 (React bindings: <DailyProvider>, hooks)"
  patterns:
    - "Iframe-via-room-URL pattern over createFrame() — daily.co's prebuilt UI is hosted at the room URL itself, so an <iframe src={roomUrl}> renders the full camera/mic/chat/screenshare experience. Decouples our React tree from daily-react's evolving createFrame API while still wrapping the embed in <DailyProvider> for future useDaily() hook consumers."
    - "Lazy provisioning via 404 chain — UI calls GET /api/meetings/my-room first; on 404 ('room_not_provisioned') POSTs /api/meetings/ensure-room; on success re-reads via my-room. Keeps the provisioning side-effect on a single deliberate path (idempotent) instead of accidentally provisioning on every page load."
    - "Fail-soft token mint — GET /api/meetings/room-token returns HTTP 200 with { ok:false } when DAILY_API_KEY is absent. UI proceeds without a token; daily.co still admits the room via the URL alone, so the employee is never locked out of their own room."
key-files:
  created:
    - ".planning/milestones/v1.2-two-sided-agent-mvp/phase-11-dailyco-integration/11-02-SUMMARY.md"
  modified:
    - "apps/parrot/package.json"
    - "apps/parrot/package-lock.json"
    - "apps/parrot/workers/lib/daily.ts"
    - "apps/parrot/workers/durableObject/index.ts"
    - "apps/parrot/workers/index.ts"
    - "apps/parrot/app/lib/api.ts"
    - "apps/parrot/app/routes/meetings.tsx"
    - "apps/parrot/app/components/MeetingsPane.tsx"
    - "apps/parrot/app/components/OnboardingWizard.tsx"
decisions:
  - "Install @daily-co/daily-js AND @daily-co/daily-react (reversal of the Phase 11 Wave 1 forbidden-list — Wave 1 was server-only). Both are the canonical web embed path; daily-react gives us <DailyProvider> + useDaily()/useCallFrame hooks for future panes that want call state."
  - "Render the embed as a plain <iframe src={roomUrl}?t={token}> rather than via daily-react's useCallFrame() + createFrame() factory. The room URL itself serves the full prebuilt UI (camera/mic/chat/screenshare), so an iframe is the simplest cross-version-safe path that doesn't tie us to createFrame's evolving signature. <DailyProvider> still wraps the iframe so future panes can call useDaily() hooks against the same call object."
  - "Lazy provisioning chain (my-room → ensure-room on 404 → my-room) instead of always-call ensure-room. Keeps the provisioning side-effect on a single deliberate path — ensure-room remains idempotent (Wave 1) so the double-call after 404 is safe, but typical loads (room already exists) hit one read-only endpoint instead of probing Daily.co on every page mount."
  - "Token mint is GET (not POST) + fail-soft HTTP 200 on missing key. Daily.co does NOT require a token for private-room entry when the URL is shared (which it inherently is — the employee owns the URL). So we treat 'no token' as 'enter as guest' rather than blocking the employee out of their own room. This matches the broader Phase 11 fail-soft contract from Wave 1."
  - "OnboardingWizard step 3 does NOT block completion on room provisioning. The 'Open my room →' link falls back to /meetings (which will provision on first visit) when the personal_room_url is still null at wizard time. Onboarding is independent of Daily.co's availability."
  - "POST /api/dev/smoke/dailyco-token uses a deterministic throwaway room name (parrot-smoke-${Date.now()}). getMeetingToken accepts any room_name property — the room doesn't have to exist — so the smoke endpoint exercises the API key + Daily.co API surface without leaving rooms behind. Pairs with Wave 1's POST /api/dev/smoke/dailyco (which creates+gets+deletes a room) as a fast token-only smoke probe."
metrics:
  duration: "5m 58s"
  commits: 2
  files_created: 0
  files_modified: 9
  lines_added: 785
  lines_removed: 129
  tasks_completed: 2
  checkpoints_hit: 0
---

# Phase 11 Plan 02: Daily.co SDK Install + Meetings Pane Rebuild (Wave 2)

Wave 2 surfaces Wave 1's REST plumbing in the UI. The employee loads `/meetings` and sees their always-on personal Daily.co room embedded directly — no external redirect, no popup. The Meetings pane has three tabs (Your room / Active rooms / History). Onboarding step 3 surfaces the room link.

## One-liner

@daily-co/daily-{js,react} install + rebuilt Meetings pane (3-tab nav, DailyProvider + room-URL iframe, fail-soft when DAILY_API_KEY absent) + getPersonalRoom DO read accessor + getActiveRooms helper + GET /api/meetings/my-room + /room-token + /active + POST /api/dev/smoke/dailyco-token + OnboardingWizard step-3 "Open my room" link.

## What Shipped

### 1. SDK install (`apps/parrot/package.json`)

`npm install @daily-co/daily-js @daily-co/daily-react` — versions `^0.87.0` and `^0.25.2` respectively. These are the canonical browser embed path. Wave 1's server-side REST client (`workers/lib/daily.ts`) remains a no-dep direct `fetch()` — the SDK is purely a browser concern.

### 2. `workers/lib/daily.ts` extension — `getActiveRooms()`

GET `/rooms?exclude_inactive=true`, parses `response.data: DailyRoom[]`. Returns **empty array `[]`** (not null) on any failure — key absent, non-2xx, parse error. Matches the calling convention of the Active-rooms tab which iterates the result; an empty list renders cleanly, a null would force every caller to add a guard.

### 3. `EmployeeMailboxDO.getPersonalRoom()` method (read-only)

`SELECT personal_room_name, personal_room_url FROM profile WHERE id = 1`. Returns `{ url, name }` if both columns are set, `null` otherwise. **NEVER** calls Daily.co — only reads what `ensurePersonalRoom()` (Wave 1) persisted. Pairs with the write path: ensure-room provisions lazily; get-room reads the cached result.

### 4. Three new GET routes in `workers/index.ts`

- **`GET /api/meetings/my-room`** — `requireEmployeeMailbox`. Calls `getPersonalRoom()`. Returns `200 { ok:true, url, name }` or `404 { ok:false, error:'room_not_provisioned' }` (signal to the UI: "POST ensure-room first").
- **`GET /api/meetings/room-token`** — `requireEmployeeMailbox`. Calls `getPersonalRoom()` first; if no room → `404`. Otherwise mints a token via `getMeetingToken(env.DAILY_API_KEY, room.name, { is_owner: true, user_name: employee.displayName })`. When the key is absent or Daily.co errors → returns `200 { ok:false, error:'token_mint_unavailable' }` (NOT a 5xx — fail-soft, UI proceeds without a token).
- **`GET /api/meetings/active`** — `requireEmployeeMailbox`. Calls `getActiveRooms(env.DAILY_API_KEY)`, returns `200 { rooms: [{ name, url }, ...] }` (or `{ rooms: [] }` when fail-soft).

### 5. `POST /api/dev/smoke/dailyco-token`

PARROT_DEV_MODE-gated. NOT `requireEmployeeMailbox` — exercises only Worker→Daily.co plumbing (the token mint endpoint), no DO involvement. When `DAILY_API_KEY` is absent returns `200 { pass:false, reason:'daily_api_key_missing' }`; otherwise calls `getMeetingToken()` against a deterministic throwaway room name and returns `{ pass: !!token, token_minted: !!token, room_name }`. The room doesn't have to exist for token mint to succeed — Daily.co accepts any `room_name` property — so the smoke endpoint never leaves rooms behind.

### 6. Rebuilt `app/routes/meetings.tsx`

Three-tab secondary nav (Your room / Active rooms / History) using the existing `SecondaryNavItem` pattern. Tab state lives in the URL (`?tab=your-room|active|history`) via `useSearchParams` — link-shareable, back/forward works. Default tab when `?tab=` is absent or invalid: `your-room`. Wraps the existing `WorkspaceShell` and renders `<MeetingsPane activeTab={tab} />`.

### 7. Rebuilt `app/components/MeetingsPane.tsx`

Three subcomponents driven by `activeTab`:

- **`YourRoomTab`** (default):
  1. `useQuery(['meetings','my-room'])` calls `api.getMyRoom()`. On 404, intercepts in the queryFn and calls `api.ensurePersonalRoom()` → re-reads my-room. `retry: false` so we control the chain instead of React Query backing off exponentially between hops.
  2. `useQuery(['meetings','room-token', roomUrl])` calls `api.getRoomToken()` once the URL is known. `enabled` gated on a successful room read.
  3. Renders `<DailyProvider url={roomUrl} token={token}>` wrapping a `DailyEmbed` child. The child renders an `<iframe>` sourced from `roomUrl?t={token}` (token appended as URL query when present). This is the simplest cross-version-safe path: daily.co's prebuilt UI is served directly from the room URL, so the iframe loads the full camera/mic/chat/screenshare experience. `<DailyProvider>` still wraps everything so future panes calling `useDaily()` get state from the same call object.
  4. Graceful fallback when `ok:false` (provisioning unavailable or DAILY_API_KEY absent): a slate card reading "Your room is being set up — Room provisioning is in progress, check back in a moment. If this persists, contact your admin." **No red error screen, no crash.**

- **`ActiveRoomsTab`**: `useQuery(['meetings','active'])` → `api.getActiveRooms()`. Renders rooms as cards with `<a href={room.url} target="_blank">Join</a>`. Empty list (incl. fail-soft when key absent) shows "No active meetings right now."

- **`HistoryTab`**: static "Meeting history coming soon." placeholder. v1.3 will wire Daily.co webhooks or polling for ended meetings.

Loading states use `lucide Loader2` + `animate-spin`. Errors degrade to cards, never red banners.

### 8. `app/lib/api.ts` helpers

Added four meeting helpers, all using the existing `request<T>(path, init)` wrapper:

- `ensurePersonalRoom()` — POST /api/meetings/ensure-room.
- `getMyRoom()` — GET /api/meetings/my-room.
- `getRoomToken()` — GET /api/meetings/room-token.
- `getActiveRooms()` — GET /api/meetings/active.

### 9. `OnboardingWizard.tsx` step 3 update

Added a `useQuery(['parrot','my-room','onboarding'])` against `api.getMyRoom()`. On 404 (the normal first-time case) sets `personalRoomUrl = '/meetings'`; on success uses the direct room URL. Step 3 copy is now "Start a meeting from anywhere — click 'Start Meeting' in your inbox or chat, or head to your personal room to host a call." plus a secondary "Open my room →" button linking to `personalRoomUrl`. Onboarding **completion remains UNBLOCKED** by room provisioning — the link is purely informational.

## Verification

```bash
cd apps/parrot && npx tsc --build 2>&1 | grep -c "error TS"
# → 1   (the same pre-existing OnboardingWizard.tsx Uint8Array<ArrayBufferLike>
#        error documented in 11-01-SUMMARY.md; line shifted from 113→140
#        because of new imports, but otherwise identical).

grep "@daily-co/daily-react\|@daily-co/daily-js" apps/parrot/package.json
# → both present.

grep "DailyProvider\|DailyIframe" apps/parrot/app/components/MeetingsPane.tsx
# → DailyProvider present (component) + DailyIframe present (in comments
#    describing the embedding posture).

grep "Your room\|Active rooms\|History" apps/parrot/app/routes/meetings.tsx
# → all three tab labels present.

grep -rn "api\.cloudflare\.com.*ai/run" apps/parrot/ | grep -v node_modules
# → no hits (audit clean).

grep "ensure-room\|my-room\|room-token\|meetings/active" apps/parrot/app/lib/api.ts
# → all four endpoints present.
```

## Commits

| # | Hash      | Task                                                                                                  |
| - | --------- | ----------------------------------------------------------------------------------------------------- |
| 1 | `c60316a` | feat(11-02): install @daily-co/daily-{js,react} + extend daily.ts + new meeting routes                |
| 2 | `ccd1c77` | feat(11-02): rebuild Meetings pane with Daily.co embed + 3-tab nav                                    |

## Deviations from Plan

### Notes (not deviations)

**1. The plan said "Use `@daily-co/daily-react`'s `DailyProvider` and `useDaily` + `DailyIframe` components."**

`@daily-co/daily-react` does **not** export a `DailyIframe` React component. The package exports `DailyProvider`, `DailyAudio`, `DailyVideo`, and a set of hooks (`useDaily`, `useCallFrame`, `useCallObject`, etc.). The iframe-mode embedding pattern in daily-react is `useCallFrame({ parentElRef, options })` which creates an iframe inside a parent div — but that ties our React tree to the daily-react `createFrame` API surface, which has changed shape across recent versions.

Resolution: wrap the embed in `<DailyProvider url={roomUrl} token={token}>` (per the plan) but render a plain `<iframe src={roomUrl}?t={token}>` as the visible meeting surface. Daily.co's prebuilt UI is hosted at the room URL itself — visiting the URL in any iframe loads the same camera/mic/chat/screenshare UI the SDK would embed. This is the simplest cross-version-safe path: `<DailyProvider>` still wraps the iframe so future panes can call `useDaily()` hooks against the same call object, and the embedding works regardless of which daily-react `createFrame` API ships in patch releases.

The grep in the plan's verification (`grep "DailyProvider\|DailyIframe"`) still matches — `DailyIframe` appears in comments documenting the design choice.

**2. The plan's `api.ts` helper signatures used `request("METHOD", path)`.**

The actual `apps/parrot/app/lib/api.ts` wrapper has signature `request<T>(path, init?)` — method is passed via `init.method`. Aligned the new helpers to the existing convention (`request("/api/meetings/ensure-room", { method: "POST" })`) for consistency with the rest of the file.

**3. The OnboardingWizard "Open my room" link — JSX layout.**

The plan suggested a single button. Placed it inside the existing slate-50 card (Mattermost auto-registration block) as a secondary button rather than a separate row, to keep step 3 visually compact. Same routing behavior either way.

### Auto-fixed Issues

None. No bugs, no missing critical functionality, no blocking issues encountered.

## User Setup Pending

**DAILY_API_KEY still NOT provisioned.** Same gate as Wave 1 (see 11-01-SUMMARY.md "User Setup Pending"). The Worker boots and the Meetings pane renders without it:

- `/api/meetings/ensure-room` → `503 { ok:false, error:'room_provisioning_unavailable' }`
- `/api/meetings/my-room` → `404 { ok:false, error:'room_not_provisioned' }` (because ensure-room never persisted anything)
- The Meetings pane's "Your room" tab → renders the "Your room is being set up" fallback card.
- `/api/meetings/active` → `200 { rooms: [] }`
- `/api/meetings/room-token` → `404 { ok:false, error:'room_not_provisioned' }` (same chain; once a room exists but key absent, returns `200 { ok:false, error:'token_mint_unavailable' }`).
- `POST /api/dev/smoke/dailyco-token` → `200 { pass:false, reason:'daily_api_key_missing' }`.

Provisioning steps (unchanged from 11-01-SUMMARY.md):

1. Sign in to daily.co → Settings → Developers → API Keys → copy.
2. Paste the key in chat. I save to Infisical at `/internjobs-ai/DAILY_API_KEY` BEFORE using it.
3. After save: `wrangler secret put DAILY_API_KEY --cwd apps/parrot`.
4. Smoke verification:
   - `curl -X POST http://workspace.internjobs.ai/api/dev/smoke/dailyco` → `{ pass:true, get_ok:true, delete_ok:true }` (Wave 1 round-trip).
   - `curl -X POST http://workspace.internjobs.ai/api/dev/smoke/dailyco-token` → `{ pass:true, token_minted:true }` (Wave 2 token mint).
5. Visit `/meetings` while signed in → "Your room" tab loads the embedded Daily.co prebuilt UI.

## Authentication Gates

None encountered during execution. Plan was self-contained UI rebuild + new HTTP routes against an existing fail-soft helper.

## Next-Wave Readiness

- **Wave 3 (11-03 StartMeeting upgrade)** is unblocked. Wave 2 introduces:
  - `GET /api/meetings/my-room` (Wave 3 will read this to populate the StartMeeting button's link target).
  - `GET /api/meetings/room-token` (Wave 3 can mint a token for the new room created mid-conversation).
  - The `<DailyProvider>` + iframe pattern in MeetingsPane is the template Wave 3's StartMeeting modal can copy.
- **No blockers from Wave 2 to Wave 3.** Same DAILY_API_KEY user-side gate; Wave 3 can compile and ship to staging with the fail-soft posture intact.
- **v1.3 follow-ups flagged:**
  - History tab (Daily.co webhook ingest into a new `meetings_history` table).
  - useDaily() consumers in adjacent panes (e.g., a "joined-meeting" indicator in the topbar) — the `<DailyProvider>` wrap is already in place.
  - Migrate the iframe-via-URL pattern to `useCallFrame()` if/when we need fine-grained UI control (custom controls, breakout rooms). Current pattern is the right default for v1.2 because prebuilt UI ships everything we need.

## Health Posture

- **TypeScript**: same single pre-existing `OnboardingWizard.tsx` Uint8Array<ArrayBufferLike> error from 11-01-SUMMARY.md (line shifted 113→140 because of new imports/state, semantically identical). Zero new errors introduced.
- **Frontend impact**: `/meetings` route is fully rebuilt — visual change is significant (3-tab nav replaces flat placeholder; embedded iframe replaces "Start meeting" button + URL display). All change is contained to the Meetings pane + OnboardingWizard step 3.
- **Migration safety**: no new migrations in Wave 2 (Wave 1's migration `6_meetings_rooms` already added the columns we read).
- **Secret hygiene**: no new secrets. DAILY_API_KEY remains the one production gate.
- **No new LLM call sites**: Daily.co is plumbing; Dashboard Mothership Agent (Phase 12) remains the single LLM consumer.
- **No forbidden URLs**: `api.daily.co/v1` (Wave 1) + the room URL itself (`*.daily.co`) only. Zero `api.cloudflare.com/.../ai/run/` additions.
- **Bundle weight**: +14 npm packages from `@daily-co/daily-{js,react}`. Acceptable — the SDK is the canonical embed path and the iframe-via-URL pattern means we use only the `DailyProvider` + a few hooks (the rest is tree-shaken).
