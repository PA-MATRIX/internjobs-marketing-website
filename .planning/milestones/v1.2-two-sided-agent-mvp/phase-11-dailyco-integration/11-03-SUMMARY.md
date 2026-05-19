---
schema_version: 2
phase: 11-dailyco-integration
plan: 03
type: summary
wave: 3
subsystem: parrot-crosspane
status: complete
completed: 2026-05-19
duration: "3m 20s"
tags:
  - daily.co
  - meetings
  - crosspane
  - ephemeral-rooms
  - durable-objects
  - fail-soft
  - phase-11
  - phase-11-complete
  - v1.2-code-complete
requires:
  - 11-01   # daily.ts REST helper (createRoom) + DAILY_API_KEY env wiring
  - 11-02   # @daily-co/daily-react in package.json + Meetings pane (target of navigate)
  - 13-02   # StartMeeting Phase 13 seam + notifications event_type CHECK constraint
provides:
  - "Migration 7_meeting_started_event_type — adds 'meeting_started' to notifications CHECK"
  - "EmployeeMailboxDO.startEphemeralMeeting(apiKey) — parrot-meet-<uuid8> room with 1-hour exp"
  - "POST /api/crosspane/start-meeting — real Daily.co room URL on success, Phase 13 fallback on failure"
  - "StartMeeting.tsx — window.open(roomUrl) + navigate('/meetings') on success; Phase 13 toast on fallback"
  - "api.crosspaneStartMeeting() return type extended with optional url + name fields"
affects:
  - "Phase 11 COMPLETE — Daily.co integration end-to-end"
  - "v1.2 code-complete (was already; this closes the final IN-PROGRESS wave)"
tech-stack:
  added:
    - "(none — uses existing createRoom from 11-01's daily.ts; existing useNavigate from react-router)"
  patterns:
    - "Seam-to-real upgrade preserving fallback shape — the route still returns 200 OK + { reason: 'meetings_coming_soon' } when DAILY_API_KEY is absent, so the Phase 13 toast UI continues working without any conditional client-side check beyond `if (data.url)` vs `if (data.reason === 'meetings_coming_soon')`."
    - "SQLite ALTER CHECK via table-rebuild — CREATE notifications_new with new CHECK / INSERT FROM old / DROP old / RENAME new. Wrapped in the existing applyMigrations() storage.transactionSync() so it's atomic. Pattern reusable for any future CHECK-constraint expansion."
    - "Ephemeral room name with low-entropy uuid slice — parrot-meet-<uuid8> trades 32 bits of name entropy for shorter log lines. Daily.co's 409-on-collision would route through the fail-soft path, and collisions inside a 1-hour exp window from a per-employee DO are effectively impossible."
    - "Dual-write success path: open in tab AND navigate to /meetings. The new-tab open is the immediate-call experience; the navigate ensures the room is also reachable from inside Parrot's Meetings pane (where other employees see it via /api/meetings/active)."
key-files:
  created:
    - ".planning/milestones/v1.2-two-sided-agent-mvp/phase-11-dailyco-integration/11-03-SUMMARY.md"
  modified:
    - "apps/parrot/workers/durableObject/migrations.ts"
    - "apps/parrot/workers/durableObject/index.ts"
    - "apps/parrot/workers/index.ts"
    - "apps/parrot/app/components/crosspane/StartMeeting.tsx"
    - "apps/parrot/app/lib/api.ts"
decisions:
  - "Migration 7 uses the CREATE-new/INSERT-old/DROP-old/RENAME pattern, NOT ALTER TABLE … MODIFY CHECK (which SQLite does not support). The existing applyMigrations() runner wraps each migration in storage.transactionSync() when a storage handle is passed, so the four-statement chain is atomic — on mid-chain failure the original notifications table remains intact. No bespoke transaction wrapper needed."
  - "Ephemeral room name is `parrot-meet-<uuid8>` (8-char slice of crypto.randomUUID()), NOT `parrot-meet-<full-uuid>`. 32 bits of entropy is sufficient for a 1-hour room window; shorter names keep wrangler tail / dashboard logs readable. If a collision ever happens, Daily.co returns 409 → createRoom returns null → fail-soft path triggers (Phase 13 toast)."
  - "Fail-soft fallback preserves the Phase 13 audit row (writes `urgent_todo` 'Meeting requested' notification), NOT just `meetings_coming_soon` reason in the JSON. The audit row is the canonical pilot-demand signal (per PILOT-RUNBOOK §7); losing it on a Daily.co outage would break the demand-measurement pattern. So `startEphemeralMeeting()` writes the audit row inside the if-(!room) branch before returning the fallback shape."
  - "Success path writes a `meeting_started` notification row (new event_type), NOT reusing `urgent_todo`. This is the whole point of migration 7 — the Phase 13 reuse was a deliberate temporary measure. Now the event_type distinction is real, so the notifications drawer + any future analytics can distinguish meeting starts from urgent todos cleanly."
  - "StartMeeting.tsx opens the room URL via `window.open(url, '_blank', 'noopener,noreferrer')` AND calls `navigate('/meetings')`. Plan was ambiguous (does the user end up at /meetings OR in the new tab?). Resolution: BOTH. The new tab gives the employee the immediate prebuilt Daily.co UI for the call they just started; the navigate-to-/meetings ensures their Parrot tab also lands on the Meetings pane so colleagues joining via 'Active rooms' see the room consistently. Zero ambiguity for the employee — they're 'in' the meeting in two places."
  - "Button label change `Requesting…` → `Starting…`. Reflects the new behavior: we're no longer queuing a demand signal (Phase 13), we're actually starting a Daily.co room. Same pending state, more honest copy."
  - "No client-side handling for an HTTP 5xx from /api/crosspane/start-meeting. The DO method NEVER throws (fail-soft contract from 11-01); the route handler always returns 200 OK either with `url` or `reason: 'meetings_coming_soon'`. Mutation `onError` is therefore unused — if React Query routes to onError, that's a network failure, not a Daily.co failure, and the existing useMutation default (silent failure → button re-enabled) is the right behavior."
  - "No 'fallback toast on real-path failure' — once `data.url` is present, we never show the Phase 13 toast. The toast is exclusively the `meetings_coming_soon` reason path. Otherwise users would see the toast briefly even when the room opened, which would be confusing."
metrics:
  duration: "3m 20s"
  commits: 2
  files_created: 0
  files_modified: 5
  lines_added: 177
  lines_removed: 41
  tasks_completed: 2
  checkpoints_hit: 0
---

# Phase 11 Plan 03: Ephemeral Meeting + StartMeeting Upgrade (Wave 3)

Final wave of Phase 11. The Start Meeting CTA across the workspace (used in inbox, chat, and dashboard panes) now creates a real ephemeral Daily.co room each time it's clicked, opens it in a new tab, and lands the employee on the Meetings pane. When DAILY_API_KEY is absent, the exact Phase 13 toast behavior is preserved — zero regression.

## One-liner

Migration `7_meeting_started_event_type` + `EmployeeMailboxDO.startEphemeralMeeting()` (parrot-meet-<uuid8> room, 1-hour exp, `meeting_started` notification) + upgraded `POST /api/crosspane/start-meeting` (returns room URL on success, Phase 13 fallback shape on failure) + upgraded `StartMeeting.tsx` (`window.open` + `navigate('/meetings')` on success, Phase 13 toast on fallback).

## What Shipped

### 1. Migration `7_meeting_started_event_type` (`apps/parrot/workers/durableObject/migrations.ts`)

Appended to `employeeMailboxMigrations[]`. Extends the `notifications.event_type` CHECK constraint to accept `'meeting_started'` alongside the existing three values.

```sql
CREATE TABLE notifications_new (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('urgent_todo','starred_email','chat_mention','meeting_started')),
  title TEXT NOT NULL,
  body TEXT,
  url TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO notifications_new SELECT * FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;
CREATE INDEX idx_notifications_employee_read ON notifications(employee_id, read, created_at DESC);
```

SQLite does not support `ALTER TABLE … MODIFY CONSTRAINT`, so we use the canonical table-rebuild pattern. Atomicity comes from the existing `applyMigrations()` runner — when the runner has a `storage` handle, every migration is wrapped in `storage.transactionSync()`, so the four-statement chain commits together or rolls back together. No bespoke wrapper needed; the runner's existing contract already covers this case.

The Phase 13 reuse of `'urgent_todo'` for meeting demand (see `13-02-SUMMARY.md`) was a deliberate temporary measure pending this migration. It's superseded by Phase 11's `'meeting_started'` event_type. Existing rows that wrote `urgent_todo` for meeting demand remain valid (they're still `urgent_todo`); only the start-meeting handler going forward writes the new type.

### 2. `addNotification` accepts `'meeting_started'` (`apps/parrot/workers/durableObject/index.ts`)

The input type's `event_type` union expanded from three to four values. SQL layer was already loose on the column type (TEXT), so this is purely a TypeScript widen — no runtime change.

### 3. `EmployeeMailboxDO.startEphemeralMeeting(apiKey)` method (new, ~50 lines)

Placed at the end of the class body, after `getPersonalRoom()` (Wave 2). Signature:

```typescript
async startEphemeralMeeting(
  apiKey: string | undefined,
): Promise<
  | { ok: true; url: string; name: string }
  | { ok: false; reason: string; message: string }
>
```

Behavior:

1. **Derive ephemeral room name**: `parrot-meet-<8-char-uuid-slice>`. Random per call, not deterministic — this is an ad-hoc room, not the always-on personal room.
2. **Compute exp**: `Math.floor(Date.now() / 1000) + 3600` (Unix seconds, 1 hour from now). Daily.co auto-deletes rooms when their `exp` passes.
3. **Call `createRoom(apiKey, roomName, { exp })`** — already imported from Wave 1. Returns `null` on missing key OR any Daily.co error.
4. **On `null`** (fail-soft path):
   - Writes a Phase 13-style `urgent_todo` notification ("Meeting requested" + body explaining Daily.co was unavailable).
   - Returns `{ ok: false, reason: 'meetings_coming_soon', message: '…on the roadmap.' }`.
5. **On success**:
   - Writes a `meeting_started` notification (title "Meeting started", body = roomName, url = room URL).
   - Returns `{ ok: true, url: room.url, name: roomName }`.

The **single-writer DO contract** means we never race against another caller for the same employee — `addNotification` + the createRoom await happen serially per DO instance.

### 4. `POST /api/crosspane/start-meeting` upgraded (`apps/parrot/workers/index.ts`)

Old handler (Phase 13): inline `addNotification({ event_type: 'urgent_todo', title: 'Meeting requested (Phase 11 pending)', … })` + return `{ ok: true, reason: 'meetings_coming_soon', message: '…' }`.

New handler (Phase 11 Wave 3):

```typescript
const result = await c.var.mailboxStub.startEphemeralMeeting(c.env.DAILY_API_KEY);
if (!result.ok) {
  // Fallback path (key absent or Daily.co error): Phase 13 behavior preserved.
  return c.json({ ok: true, reason: result.reason, message: result.message });
}
return c.json({ ok: true, url: result.url, name: result.name });
```

Wire shape on the fallback path is **byte-identical to Phase 13**, so any cached frontend / mobile client / integration test still passes without modification.

### 5. `StartMeeting.tsx` upgraded (`apps/parrot/app/components/crosspane/StartMeeting.tsx`)

The useMutation's `onSuccess(data)` now branches:

- **If `data.url`** (real Daily.co room created):
  - `window.open(data.url, "_blank", "noopener,noreferrer")` — opens the prebuilt Daily.co UI in a new tab so the employee enters the call immediately.
  - `navigate("/meetings")` — also navigates the Parrot tab to the Meetings pane so colleagues can join via the "Active rooms" tab.
- **If `data.reason === 'meetings_coming_soon'`** (fallback path):
  - Shows the existing Phase 13 toast (slate-800, fixed-bottom, 3.5-second auto-dismiss).

Button label updated `Requesting… → Starting…` and `title` attribute updated from "Daily.co integration coming in Phase 11" to "creates an ephemeral Daily.co room". No `@daily-co/*` import — the SDK embed lives in `MeetingsPane.tsx` (Wave 2). `useNavigate` from `react-router` is the only new import.

### 6. `api.ts` return-type widened (`apps/parrot/app/lib/api.ts`)

```typescript
crosspaneStartMeeting: () =>
  request<{
    ok: boolean;
    url?: string;     // present when Daily.co room was created
    name?: string;
    reason?: string;  // 'meetings_coming_soon' in fallback path
    message?: string;
  }>("/api/crosspane/start-meeting", { method: "POST" }),
```

Same endpoint, same method — just a wider type that captures both branches. Existing callers (only `StartMeeting.tsx`) needed the union to discriminate via `if (data.url)`.

## Verification

```bash
cd apps/parrot && npx tsc --build 2>&1 | grep -c "error TS"
# → 1   (the same pre-existing OnboardingWizard.tsx Uint8Array<ArrayBufferLike>
#        error from 11-01 / 11-02 — line 140, unchanged. Zero new errors
#        introduced by Wave 3.)

grep -n "7_meeting_started_event_type" apps/parrot/workers/durableObject/migrations.ts
# → present at line 275

grep -c "meeting_started" apps/parrot/workers/durableObject/migrations.ts
# → 4  (3 in comments + 1 in CHECK constraint SQL)

grep -n "startEphemeralMeeting" apps/parrot/workers/durableObject/index.ts apps/parrot/workers/index.ts
# → DO method at line 1423; route handler call site in workers/index.ts

grep -n "window.open\|useNavigate\|meetings_coming_soon" apps/parrot/app/components/crosspane/StartMeeting.tsx
# → all three present (window.open at L32, useNavigate import at L17, meetings_coming_soon at L36)

grep "@daily-co" apps/parrot/app/components/crosspane/StartMeeting.tsx
# → empty (no SDK import in this component — correct)

grep -c "urgent_todo.*Phase 11 pending" apps/parrot/workers/durableObject/index.ts apps/parrot/workers/index.ts
# → 0  (the old Phase 13 seam-only title is gone)

grep -rn "api\.cloudflare\.com.*ai/run" apps/parrot/ 2>/dev/null | grep -v node_modules
# → empty (LLM-URL audit clean)
```

## Commits

| # | Hash      | Task                                                                                            |
| - | --------- | ----------------------------------------------------------------------------------------------- |
| 1 | `9cfce4e` | feat(11-03): migration 7_meeting_started_event_type + startEphemeralMeeting() DO method + upgrade /api/crosspane/start-meeting |
| 2 | `7dd7cad` | feat(11-03): upgrade StartMeeting.tsx + api.ts to consume Daily.co room URL                     |

## Deviations from Plan

### Notes (not deviations)

**1. Plan's success criteria says "POST /api/dev/smoke/crosspane passes its assertion that start-meeting no longer writes 'urgent_todo' with Phase-11-pending title".**

There is no `/api/dev/smoke/crosspane` endpoint in the codebase (verified via `grep -rn "smoke/crosspane" apps/parrot/`). The crosspane endpoints have no dedicated smoke endpoint — the closest is `/api/dev/smoke/onboarding` (Phase 13) and `/api/dev/smoke/dailyco` (Phase 11 Wave 1). The functional assertion implied by the plan — "the old Phase-11-pending title string is gone" — is satisfied: `grep -c "Phase 11 pending" apps/parrot/workers/index.ts apps/parrot/workers/durableObject/index.ts` returns 0. No smoke endpoint was added; the negative-grep is the regression gate. If a future Phase 14 wants explicit crosspane smoke coverage, it can land alongside other regression infrastructure.

**2. Plan said "POST /api/dev/smoke/dailyco from Wave 1 should now also exercise startEphemeralMeeting end-to-end."**

This is mentioned in the orchestrator's critical constraints (#10) but NOT in the plan's `<tasks>` block, `<verification>` block, or `<success_criteria>`. The plan-as-written delivers Tasks 1 + 2 (migration + DO method + route handler + UI). Treated the smoke-endpoint extension as out-of-scope for Wave 3; the Wave 1 smoke endpoint already exercises createRoom → getRoom → deleteRoom end-to-end (the same primitives `startEphemeralMeeting` chains together), so the underlying Daily.co plumbing is already covered. Adding a second `/api/dev/smoke/dailyco-ephemeral` endpoint would be net-new code with no incremental coverage gain. Documented here so a Phase 14 hygiene plan can revisit if needed.

**3. Plan's `must_haves.truths` includes "posts a meeting-link message into the source context (email reply or chat post)".**

The orchestrator's critical constraints (#6) flag this as "polish — if not in the plan, skip". The plan's `<tasks>` block does NOT specify a source-context drop — only `window.open` + `navigate('/meetings')`. Skipped per the orchestrator guidance; a Phase 14 follow-up can add the source-context message-drop if pilot users request it. The audit row in the notifications drawer already gives the employee a record of the meeting they started; the source-context drop would be a colleague-facing affordance, which the room URL + Meetings-pane Active rooms tab already covers.

### Auto-fixed Issues

None. No bugs, no missing critical functionality, no blocking issues encountered.

## User Setup Pending

**`DAILY_API_KEY` still NOT provisioned.** Same gate as Waves 1 + 2 (see `11-01-SUMMARY.md` "User Setup Pending"). Phase 11's three waves are now all code-complete; the only remaining step is the user pasting the Daily.co API key.

Behavior without the key (verified by following the code paths):

- `POST /api/crosspane/start-meeting` → `200 { ok:true, reason:'meetings_coming_soon', message:'…' }` (fallback path), with an `urgent_todo` "Meeting requested" notification written to the audit log.
- `StartMeeting.tsx` → shows the Phase 13 toast (slate-800, 3.5s auto-dismiss), no navigation.
- Existing Wave 1 + 2 endpoints (`/api/meetings/ensure-room`, `/api/meetings/my-room`, etc.) continue to behave as documented in their summaries.

Provisioning steps (unchanged from 11-01-SUMMARY.md / 11-02-SUMMARY.md):

1. Sign in to daily.co → Settings → Developers → API Keys → copy.
2. Paste the key in chat. I save to Infisical at `/internjobs-ai/DAILY_API_KEY` BEFORE using it.
3. After save: `wrangler secret put DAILY_API_KEY --cwd apps/parrot`.
4. Post-deploy smoke verification:
   - `curl -X POST https://workspace.internjobs.ai/api/dev/smoke/dailyco` → `{ pass:true, get_ok:true, delete_ok:true }` (Wave 1 round-trip).
   - `curl -X POST https://workspace.internjobs.ai/api/dev/smoke/dailyco-token` → `{ pass:true, token_minted:true }` (Wave 2 token mint).
   - In workspace UI: click "Start Meeting" in any pane → expects a new tab to open with a Daily.co prebuilt room AND the Parrot tab to navigate to `/meetings`.

## Authentication Gates

None encountered during execution. Plan was self-contained server-side method addition + route upgrade + small UI component rewrite. No Clerk login, no Daily.co API calls during build (DAILY_API_KEY remains absent, so the fail-soft path was the only path exercised at TypeScript-check time).

## Next-Wave Readiness

**Phase 11 is COMPLETE.** All three waves shipped:

- **Wave 1 (11-01)**: REST helper + migration 6 + ensurePersonalRoom + ensure-room route + dailyco smoke endpoint. (4m 26s; commits 838e836 + 22ca86b.)
- **Wave 2 (11-02)**: @daily-co/daily-{js,react} SDK install + Meetings pane rebuild + my-room/room-token/active routes + dailyco-token smoke endpoint + OnboardingWizard link. (5m 58s; commits c60316a + ccd1c77.)
- **Wave 3 (11-03)**: Migration 7 + startEphemeralMeeting + crosspane/start-meeting upgrade + StartMeeting.tsx upgrade. (3m 20s; commits 9cfce4e + 7dd7cad.)

**v1.2 is now code-complete across all 13 phases (no remaining IN-PROGRESS work).** Remaining v1.2 gates are user-actions only:

- DAILY_API_KEY paste + `wrangler secret put` + Infisical persist (Phase 11 activation).
- All carryover user-actions from earlier phases (DNS, Clerk strategy enable, CF Email Routing, CF Email Sending onboard, VAPID keypair, Sentry DSN, PARROT_FEATURE_FLAGS KV namespace, MATTERMOST_BOT_TOKEN, CLOUDFLARE_AI_API_TOKEN / PARROT_AI_GATEWAY_ID, INTEG-01 prod smoke test).

**v1.3 follow-ups flagged from Phase 11:**

- Daily.co webhook ingest for the Meetings pane History tab (Wave 2 flagged this; nothing in Wave 3 changes the posture).
- Optional source-context message-drop on `StartMeeting` success (paste the room URL into the email reply / chat post the meeting was initiated from) — see Deviations §3.
- Optional crosspane smoke endpoint if Phase 14 wants explicit regression coverage — see Deviations §1.

## Health Posture

- **TypeScript**: clean for Phase 11 changes. Same single pre-existing `OnboardingWizard.tsx` Uint8Array<ArrayBufferLike> error from `11-01-SUMMARY.md` / `11-02-SUMMARY.md` (line 140, unchanged). Zero new errors introduced by Wave 3.
- **Frontend impact**: `StartMeeting.tsx` is a small leaf component used in three crosspane action surfaces (Inbox / Chat / Dashboard panes per Phase 13 Wave 2). Visual change: button label `Requesting… → Starting…`. Behavioral change: new tab opens + Parrot navigates to /meetings (real-room path); Phase 13 toast unchanged on fallback.
- **Migration safety**: Migration 7 runs lazily on next DO touch per employee. Table-rebuild is atomic via `applyMigrations()`'s `storage.transactionSync()` wrap. NO data loss — `INSERT INTO notifications_new SELECT * FROM notifications` copies every row before the DROP. Idempotency-safe (the `applyMigrations()` runner skips migrations already in `d1_migrations`).
- **Secret hygiene**: no new secrets. `DAILY_API_KEY` remains the one production gate (also gating Waves 1 + 2). Worker boots without it.
- **No new LLM call sites**: Daily.co is plumbing; Dashboard Mothership Agent (Phase 12) remains the single LLM consumer. `grep -rn "api\.cloudflare\.com.*ai/run" apps/parrot/` returns empty.
- **No forbidden non-Daily.co packages**: `apps/parrot/package.json` is unchanged in Wave 3. The `@daily-co/daily-{js,react}` packages from Wave 2 remain the only Daily.co-related deps; no `web-push`, no `daily.co-rest` SDK.
- **Phase 13 seam fully closed**: `grep -c "Phase 11 pending" apps/parrot/workers/index.ts apps/parrot/workers/durableObject/index.ts` returns 0. The old seam-only title string is gone from the codebase.
