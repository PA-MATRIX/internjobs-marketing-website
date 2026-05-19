---
schema_version: 2
phase: 11-dailyco-integration
plan: 01
type: summary
wave: 1
subsystem: parrot-worker
status: complete
completed: 2026-05-19
duration: "4m 26s"
tags:
  - daily.co
  - meetings
  - rest-helper
  - durable-objects
  - fail-soft
  - phase-11
requires:
  - 10-02   # EmployeeMailboxDO + profile table
  - 13-03   # migration 5_onboarding_flags (the migration this builds on)
provides:
  - "apps/parrot/workers/lib/daily.ts — REST client (createRoom, getRoom, deleteRoom, getMeetingToken)"
  - "Migration 6_meetings_rooms — personal_room_url + personal_room_name on profile"
  - "EmployeeMailboxDO.ensurePersonalRoom(apiKey)"
  - "POST /api/meetings/ensure-room"
  - "POST /api/dev/smoke/dailyco"
  - "DAILY_API_KEY plumbed into Env interface + wrangler.jsonc secrets contract"
affects:
  - 11-02   # Meetings pane rebuild — consumes ensure-room URL
  - 11-03   # StartMeeting upgrade — consumes the same endpoint
tech-stack:
  added:
    - "Daily.co REST API (no npm dep — direct fetch())"
  patterns:
    - "Inline-helper-over-SDK posture (3rd recurrence: VAPID, Sentry, now Daily.co)"
    - "Fail-soft on missing secret — return null/error union, never throw"
    - "Deterministic room-name derivation (parrot-<clerk_user_id>) → idempotency without an extra lookup table"
    - "Backwards-compat 308 redirect when renaming a route"
key-files:
  created:
    - "apps/parrot/workers/lib/daily.ts"
    - ".planning/milestones/v1.2-two-sided-agent-mvp/phase-11-dailyco-integration/11-01-SUMMARY.md"
  modified:
    - "apps/parrot/workers/types.ts"
    - "apps/parrot/wrangler.jsonc"
    - "apps/parrot/workers/durableObject/migrations.ts"
    - "apps/parrot/workers/durableObject/index.ts"
    - "apps/parrot/workers/index.ts"
decisions:
  - "Use fetch() directly instead of pulling in a daily.co SDK npm package — same posture as workers/lib/vapid.ts (VAPID signer) and the inline Sentry envelope in workers/index.ts. Four narrow REST calls don't justify a transitive-dep-heavy SDK."
  - "Derive room name as parrot-<employee_id> (Clerk user ID) rather than a UUID — deterministic so we can recompute the URL anywhere we have the employee ID, no extra lookup table needed."
  - "fail-soft contract: every daily.ts function returns null on missing key OR non-2xx. NEVER throws. Matches VAPID/Sentry posture so a Daily.co outage cannot escalate to a Worker crash."
  - "Keep /api/meetings/create alive as a 308 redirect to /api/meetings/ensure-room. The old stub URL is referenced by any cached frontend or operator runbook; 308 preserves the POST method on redirect (vs 301/302) — no client breakage."
  - "Smoke endpoint is NOT requireEmployeeMailbox-gated. It only exercises Worker→Daily.co plumbing (create a throwaway room, GET it, DELETE it) — no DO involvement — so PARROT_DEV_MODE alone is the right gate. Matches the design of the dailyco endpoint: pass: true/false with reason, never a 5xx."
metrics:
  duration: "4m 26s"
  commits: 2
  files_created: 1
  files_modified: 5
  lines_added: 367
  lines_removed: 11
  tasks_completed: 2
  checkpoints_hit: 0
---

# Phase 11 Plan 01: Daily.co REST Helper + Migration 6 + ensure-room Endpoint + Smoke

Wave 1 server-side plumbing for Daily.co integration: REST client, profile schema migration, lazy per-employee room provisioning, and a dev smoke endpoint. Wired but inert until DAILY_API_KEY is set; fail-soft posture ensures the Worker boots and runs without it.

## One-liner

Daily.co REST helper (no SDK) + migration 6_meetings_rooms + ensurePersonalRoom() DO method + /api/meetings/ensure-room + /api/dev/smoke/dailyco — all fail-soft when DAILY_API_KEY is absent.

## What Shipped

### 1. `apps/parrot/workers/lib/daily.ts` (172 lines, NEW)

The single REST client for every Daily.co call the Worker makes. Exposes four functions, all sharing a private `dailyFetch<T>()` choke point:

- `createRoom(apiKey, name, options?)` — POST /rooms, returns `DailyRoom | null`.
- `getRoom(apiKey, name)` — GET /rooms/:name, returns `DailyRoom | null`.
- `deleteRoom(apiKey, name)` — DELETE /rooms/:name, returns `{ deleted: true } | null`.
- `getMeetingToken(apiKey, roomName, options)` — POST /meeting-tokens, returns `DailyMeetingToken | null`.

**Fail-soft contract**: when `apiKey` is undefined/empty, `dailyFetch()` returns `null` without hitting the network. On non-2xx responses we log via `console.error("daily.co", status, path, text)` and also return `null`. Functions NEVER throw — a Daily.co outage cannot escalate to a Worker crash.

**No npm dependency**. Mirrors the posture established by `workers/lib/vapid.ts` (inline VAPID signer) and `reportToSentry()` in `workers/index.ts` (inline Sentry envelope). Four narrow REST calls don't justify a transitive-dep-heavy SDK. The Daily.co SDK (`@daily-co/daily-react`, `@daily-co/daily-js`) is a browser concern and installs in Wave 2 where the React `<DailyProvider>` needs it.

### 2. Migration `6_meetings_rooms`

Appended to `employeeMailboxMigrations[]` in `apps/parrot/workers/durableObject/migrations.ts`:

```sql
ALTER TABLE profile ADD COLUMN personal_room_name TEXT;
ALTER TABLE profile ADD COLUMN personal_room_url TEXT;
```

NULL-safe (no DEFAULT, no UPDATE pass) — existing rows interpret NULL as "no room yet, provision on next call", matching the pattern set by migration `5_onboarding_flags`.

### 3. `EmployeeMailboxDO.ensurePersonalRoom(apiKey)` method

New method on the DO. Behavior:

1. SELECT `personal_room_url` + `personal_room_name` FROM profile WHERE id = 1.
2. If both non-null → return `{ ok: true, url, name }` immediately (idempotent — no Daily.co call).
3. Derive `roomName = "parrot-" + employee_id` (Clerk user IDs are already URL-safe).
4. Call `createRoom(apiKey, roomName)`. Returns null when key absent OR Daily.co errors.
5. On null → return `{ ok: false, error: "room_provisioning_unavailable" }`.
6. On success → UPDATE profile SET personal_room_name + personal_room_url + updated_at = now() WHERE id = 1, then return `{ ok: true, url, name }`.

The "check existing → create → persist" trio is race-free thanks to the DO's single-writer guarantee per employee. No additional locking needed.

### 4. `POST /api/meetings/ensure-room` route

Replaces the Wave-3 stub at `/api/meetings/create`. requireEmployeeMailbox-gated. Calls `c.var.mailboxStub.ensurePersonalRoom(c.env.DAILY_API_KEY)` and:

- On `{ ok: true }` → returns `200 { ok: true, url, name }`.
- On `{ ok: false }` → returns `503 { ok: false, error }`. UI degrades to the Phase 13 toast.

The old `/api/meetings/create` URL is kept as a `308` redirect (preserves POST method) so any cached frontend code doesn't 404.

### 5. `POST /api/dev/smoke/dailyco` endpoint

PARROT_DEV_MODE-gated. NOT requireEmployeeMailbox-gated (it only exercises Worker→Daily.co plumbing, no DO involvement). Behavior:

- If `PARROT_DEV_MODE` falsy → `403 { error: "dev mode only" }`.
- If `DAILY_API_KEY` absent → `200 { pass: false, reason: "daily_api_key_missing", detail: ... }`. NOT a 5xx — the smoke endpoint must report fail-soft status without breaking.
- Otherwise: createRoom → getRoom → deleteRoom on a throwaway `parrot-smoke-${Date.now()}` name. Returns `{ pass: !!fetched && !!deleted, room_name, room_url, get_ok, delete_ok }`.

### 6. `DAILY_API_KEY` env wiring

- `apps/parrot/workers/types.ts`: added `"DAILY_API_KEY"` to the `CfEnvBase` Omit tuple + `DAILY_API_KEY?: string` to the `Env` interface (with doc comment).
- `apps/parrot/wrangler.jsonc`: appended the secret to the secrets comment contract (same format as SENTRY_DSN entry — Infisical path at `/internjobs-ai/DAILY_API_KEY`, fail-soft behavior, set-via incantation).

## Verification

```bash
cd apps/parrot && npx tsc --build
# Only pre-existing OnboardingWizard.tsx error (Uint8Array<ArrayBufferLike>);
# zero new errors introduced by Phase 11 changes. Confirmed by stashing
# my changes and re-running tsc — same OnboardingWizard error on stock main.

grep -c "DAILY_API_KEY" apps/parrot/workers/types.ts
# → 4   (Omit list + Env field + 2 in doc comment)

grep -c "6_meetings_rooms" apps/parrot/workers/durableObject/migrations.ts
# → 1

grep -n "ensure-room\|smoke/dailyco" apps/parrot/workers/index.ts
# → both routes present

grep -n "ensurePersonalRoom" apps/parrot/workers/durableObject/index.ts
# → method at line 1311

grep -E "@daily-co|daily-js|daily-react" apps/parrot/package.json
# → no match (correct: SDK lands in Wave 2)
```

## Commits

| # | Hash      | Task                                                     |
| - | --------- | -------------------------------------------------------- |
| 1 | `838e836` | feat(11-01): daily.ts REST helper + migration 6_meetings_rooms + DAILY_API_KEY env |
| 2 | `22ca86b` | feat(11-01): ensurePersonalRoom() DO method + /api/meetings/ensure-room + smoke endpoint |

## Deviations from Plan

### Auto-handled (Rule 3 — blocking)

**1. Plan said "Place ensurePersonalRoom after `sendPushToSubscriptions` and before `emailToChat`"**

The plan's positional instruction was contradictory: in the actual DO file, `emailToChat` is at line 1053 and `sendPushToSubscriptions` is at line 1219 — `sendPushToSubscriptions` is AFTER `emailToChat`, not before. There is no slot "after sendPushToSubscriptions AND before emailToChat."

Resolution: inserted `ensurePersonalRoom` immediately after `sendPushToSubscriptions` (at end of class body, before the closing brace). This is the cleanest position; the in-class method order doesn't affect runtime semantics. Plan intent was clearly "make it the last method on the class," which is what landed.

### Notes (not deviations)

- The plan's smoke endpoint code sample showed `async (c) => {` without `: AppContext`. I aligned it with the rest of the file's typing convention (`async (c: AppContext) =>`) for TypeScript strictness — same pattern used in `/api/dev/smoke/onboarding` next door.

- The plan's success criteria expected `grep -c "DAILY_API_KEY" types.ts >= 2`. Actual count is 4 (Omit tuple entry + Env field declaration + 2 in the doc comment block). Plan intent was "at least 2"; we comfortably exceed.

## User Setup Pending

DAILY_API_KEY has NOT been provisioned yet. The Worker boots and runs without it; `/api/meetings/ensure-room` returns 503 and `/api/dev/smoke/dailyco` reports `pass: false, reason: "daily_api_key_missing"` until the key is pushed.

Provisioning steps (from plan's `<user_setup>` block):

1. Sign in to daily.co → Settings → Developers → API Keys → copy.
2. Paste the key in chat. I save to Infisical at `/internjobs-ai/DAILY_API_KEY` BEFORE using it.
3. After save: `wrangler secret put DAILY_API_KEY --cwd apps/parrot` (paste the same value when prompted).
4. Smoke verification: `wrangler tail` in one shell, then `curl -X POST http://workspace.internjobs.ai/api/dev/smoke/dailyco` → expects `{ pass: true, get_ok: true, delete_ok: true }`.

## Authentication Gates

None encountered. The plan was self-contained server-side work — no Clerk login, no Daily.co API calls during build (the smoke endpoint exists but was not invoked during plan execution since DAILY_API_KEY is absent, which is the expected Wave 1 state).

## Next-Wave Readiness

- **Wave 2 (11-02 Meetings pane rebuild)** can begin: `daily.ts` exposes `getMeetingToken()` for the React component's token mint flow; `ensure-room` provides the room URL. Wave 2 installs `@daily-co/daily-react` + `@daily-co/daily-js` and adds a `<DailyProvider>` embedding the URL from the API.
- **Wave 3 (11-03 StartMeeting upgrade)** can begin in parallel with Wave 2 (no shared files between them — Wave 3 is the cross-pane action button; Wave 2 is the meetings pane itself). Both call `POST /api/meetings/ensure-room` and read the returned URL.
- **No blockers for Wave 2 / Wave 3 from Wave 1.** DAILY_API_KEY remains the one user-side gate; both Waves can compile and ship to staging with the same fail-soft posture Wave 1 established.

## Health Posture

- **TypeScript**: Clean for Phase 11 changes. One pre-existing error in `OnboardingWizard.tsx` (Uint8Array<ArrayBufferLike> assignment — unrelated, exists on stock main).
- **Frontend impact**: None (Wave 1 is backend-only per the plan's `verification.surface: backend_only` declaration).
- **Migration safety**: Migration `6_meetings_rooms` runs lazily on next DO touch per employee. NULL-safe ALTERs — no downtime, no DEFAULT writes.
- **Secret hygiene**: DAILY_API_KEY documented in wrangler.jsonc secrets comment contract. Path: Infisical `/internjobs-ai/DAILY_API_KEY`. Worker boots without it.
- **No new LLM call sites**: Daily.co is plumbing; the Dashboard Mothership Agent path remains the single LLM consumer (Phase 12).
- **No forbidden URLs**: `api.daily.co/v1` only; zero `api.cloudflare.com/.../ai/run/` additions.
