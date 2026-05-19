---
phase: 13-cross-pane-launch-polish
plan: 01
subsystem: notifications
tags: [web-push, vapid, service-worker, durable-objects, react-router, hono, lucide, react-query]

# Dependency graph
requires:
  - phase: 12-dashboard-mothership-agent
    provides: "todos table + insertTodos() choke-point on EmployeeMailboxDO (urgency_score-based push trigger lives here)"
  - phase: 12-dashboard-mothership-agent
    provides: "pollMattermostNewPosts() alarm cycle (@mention push trigger lives here)"
  - phase: 10-parrot-internal-workspace
    provides: "createEmail() Inbox path (starred-email push trigger lives here) + WorkspaceShell topbar surface"
provides:
  - "Per-employee notifications table on EmployeeMailboxDO (migration 4_notifications_push)"
  - "Per-employee push_subscriptions table on EmployeeMailboxDO (one row per registered browser endpoint)"
  - "7 DO methods: addPushSubscription, removePushSubscription, getPushSubscriptions, addNotification, getNotifications, markNotificationsRead, sendPushToSubscriptions"
  - "Hono routes: POST/DELETE /api/push/subscribe, GET /api/notifications, POST /api/notifications/mark-read, POST /api/dev/smoke/push (dev-only)"
  - "Service worker at /sw.js — push + notificationclick handlers, intentionally NO fetch listener (Vite/React Router own asset caching)"
  - "NotificationDrawer flyout in WorkspaceShell topbar with bell badge + 30s polling"
  - "workers/lib/vapid.ts — RFC 8292 Authorization header via crypto.subtle ES256 (no npm web-push dep)"
  - "Env types: PUSH_VAPID_PRIVATE_KEY (secret, optional) + PUSH_VAPID_PUBLIC_KEY (var, optional)"
affects:
  - "13-02 (cross-pane actions) — can store notification rows on actor-side cross-pane events"
  - "13-03 (onboarding wizard) — push opt-in toggle wires PushManager.subscribe → api.subscribePush()"
  - "Future v1.3 — RFC 8291 (aes128gcm) encrypted push body, replacing the current unencrypted JSON payload"

# Tech tracking
tech-stack:
  added:
    - "Web Push (W3C, RFC 8030) via VAPID-signed JWT (crypto.subtle ES256, no npm)"
    - "Service Worker registration (navigator.serviceWorker.register on mount)"
  patterns:
    - "Trigger-at-source: push fan-out lives next to the source-of-truth mutation (insertTodos, createEmail, pollMattermostNewPosts) rather than in a separate event bus"
    - "Drawer-first, push-second: addNotification always runs even when VAPID keys are missing — the in-app drawer is the canonical surface; browser push is a delivery enhancement"
    - "VAPID-key-optional Worker: env declares both keys as optional, sendPushToSubscriptions degrades to drawer-only with a console.warn — boot never depends on push being provisioned"

key-files:
  created:
    - "apps/parrot/public/sw.js — push + notificationclick handlers (vanilla JS, served by Vite)"
    - "apps/parrot/workers/lib/vapid.ts — VAPID Authorization header builder via crypto.subtle"
  modified:
    - "apps/parrot/workers/durableObject/migrations.ts — adds migration 4_notifications_push"
    - "apps/parrot/workers/durableObject/index.ts — 7 push/notification methods + 3 trigger sites"
    - "apps/parrot/workers/index.ts — push/notifications API routes + dev smoke endpoint"
    - "apps/parrot/workers/types.ts — PUSH_VAPID_* env fields"
    - "apps/parrot/wrangler.jsonc — PUSH_VAPID_PUBLIC_KEY var + PUSH_VAPID_PRIVATE_KEY secret contract comment"
    - "apps/parrot/app/components/WorkspaceShell.tsx — bell button, drawer, SW registration, 30s notification poll"
    - "apps/parrot/app/lib/api.ts — NotificationItem/NotificationsResponse types + 4 API helpers"

key-decisions:
  - "VAPID signing via crypto.subtle (Workers built-in) instead of npm web-push (Node-only, forbidden in the plan)"
  - "Send raw JSON push payloads (NOT RFC 8291 aes128gcm-encrypted) for v1.2 — title/body/url have no PII-sensitivity that justifies the encryption complexity right now; flagged for v1.3"
  - "Service worker is push-only — explicitly NO fetch listener — to avoid colliding with Vite/React Router asset caching"
  - "PUSH_VAPID_* are optional in the Env type so the Worker boots without keys; sendPushToSubscriptions still records the drawer row and logs a warning"
  - "Bell badge is a red dot (not an unread count digit) — matches the visual weight of Slack/Linear and avoids re-layout when unread crosses double digits"

patterns-established:
  - "VAPID-optional degradation: notification rows always land; push fan-out is best-effort gated on PUSH_VAPID_{PRIVATE,PUBLIC}_KEY being set"
  - "Trigger-at-source push hooks: every sendPushToSubscriptions call lives inline next to the table write that justifies it (urgency>=70 in insertTodos, starred+inbox in createEmail, @displayName in pollMattermostNewPosts)"
  - "Dev-only smoke endpoint per major surface: /api/dev/smoke/{seed-email,ranking,push} — PARROT_DEV_MODE-gated, deterministic, returns { pass: bool, ... } for CI scripting"

# Metrics
duration: 7m 31s
completed: 2026-05-19
---

# Phase 13 Plan 01: Cross-pane Notifications + Push Summary

**Browser push notifications (urgent todo, starred email, @mention) wired to per-employee EmployeeMailboxDO with VAPID signing via crypto.subtle, a vanilla-JS service worker, and a bell+drawer UI in WorkspaceShell — all behind a graceful-degradation flag so the Worker boots cleanly before VAPID keys are provisioned.**

## Performance

- **Duration:** 7m 31s
- **Started:** 2026-05-19T05:50:57Z
- **Completed:** 2026-05-19T05:58:28Z
- **Tasks:** 2 / 2
- **Files modified:** 7 (+ 2 created)

## Accomplishments

- Migration `4_notifications_push` adds two per-employee tables (`notifications`, `push_subscriptions`) with the read-state index needed for the drawer and the per-employee index needed for fan-out.
- EmployeeMailboxDO gets 7 push/notification methods (`addPushSubscription`, `removePushSubscription`, `getPushSubscriptions`, `addNotification`, `getNotifications`, `markNotificationsRead`, `sendPushToSubscriptions`) plus 3 inline trigger hooks (urgency >= 70 in `insertTodos`, starred + Inbox in `createEmail`, `@displayName` match in `pollMattermostNewPosts`).
- VAPID JWT signing via `crypto.subtle.importKey('pkcs8', …, ECDSA P-256)` + `crypto.subtle.sign` — zero npm deps. Handles PEM with `-----BEGIN PRIVATE KEY-----` framing or bare base64 body. The Authorization header is built in `workers/lib/vapid.ts::buildVapidAuthHeader`.
- Service worker at `public/sw.js` (vanilla JS, served by Vite from the root) handles `push` (renders `Notification.showNotification`) and `notificationclick` (focuses existing tab + navigates, else `clients.openWindow`). Intentionally **no fetch listener** — Vite + React Router own asset caching.
- Hono routes: `POST /api/push/subscribe`, `DELETE /api/push/subscribe`, `GET /api/notifications`, `POST /api/notifications/mark-read`, plus dev-only `POST /api/dev/smoke/push` that exercises store/read/mark-read without requiring live VAPID keys.
- WorkspaceShell gets: SW registration on mount, a 30s `useQuery` poll against `/api/notifications`, a Bell button in the topbar with a red-dot badge when `unread > 0`, and a slide-in NotificationDrawer with event-typed icons (Bell/Mail/MessageSquare), unread highlighting, relative-time labels, and click-to-navigate + auto-mark-read rows.

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration 4_notifications_push + DO methods for notifications and push** — `41818a2` (feat)
2. **Task 2: Service worker + push API endpoints + notification drawer UI** — `e369ddd` (feat)

**Plan metadata:** (this SUMMARY + STATE.md update will be the third atomic commit)

## Files Created/Modified

**Created:**
- `apps/parrot/public/sw.js` — push + notificationclick handlers, no fetch listener
- `apps/parrot/workers/lib/vapid.ts` — VAPID Authorization header via crypto.subtle ES256

**Modified:**
- `apps/parrot/workers/durableObject/migrations.ts` — appends migration `4_notifications_push`
- `apps/parrot/workers/durableObject/index.ts` — 7 new methods + 3 inline trigger sites + Skills-referenced header
- `apps/parrot/workers/index.ts` — 4 new routes + 1 dev smoke endpoint
- `apps/parrot/workers/types.ts` — `PUSH_VAPID_PRIVATE_KEY` + `PUSH_VAPID_PUBLIC_KEY` env fields (optional)
- `apps/parrot/wrangler.jsonc` — `PUSH_VAPID_PUBLIC_KEY` var placeholder + `PUSH_VAPID_PRIVATE_KEY` secret contract comment
- `apps/parrot/app/components/WorkspaceShell.tsx` — bell button, NotificationDrawer, SW registration, 30s poll
- `apps/parrot/app/lib/api.ts` — `NotificationItem`/`NotificationsResponse` types + `getNotifications`/`markNotificationsRead`/`subscribePush`/`unsubscribePush` helpers

## Decisions Made

- **VAPID via crypto.subtle, not npm `web-push`.** The plan explicitly forbids `web-push` (Node-only) and the Workers runtime ships `crypto.subtle` with full ECDSA P-256 support. We implement the RFC 8292 Authorization header inline (`workers/lib/vapid.ts`) with zero deps.
- **Unencrypted JSON push body for v1.2.** RFC 8291 aes128gcm encryption is real work and the title/body/url payloads we send are not PII-sensitive. Flagged as a v1.3 follow-up in code comments; the SW already parses `event.data.json()` so a future swap to encrypted bodies is internal.
- **Service worker is push-only.** No `fetch` event listener so Vite/React Router asset caching is untouched. Verified by grep gate.
- **`PUSH_VAPID_*` env are optional.** The Worker boots without them. `sendPushToSubscriptions` records the drawer row, logs `console.warn`, and returns early — no crash. This decouples the code-merge from the pre-execution user action of generating VAPID keys.
- **Per-employee scoping unchanged.** Both new tables live on EmployeeMailboxDO via `4_notifications_push`. No new DO class. The push fan-out only iterates subscriptions for the current DO's employee_id.
- **Bell badge is a dot, not a count.** Matches Slack/Linear visual density and avoids relayout when unread crosses 9→10.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `workers/lib/vapid.ts` (not in plan's `files_modified`)**
- **Found during:** Task 1 (DO methods needed `buildVapidAuthHeader` to compose the Web Push Authorization header)
- **Issue:** The plan describes VAPID signing inline inside `sendPushToSubscriptions`, which would make the method 80+ lines and tightly couple key parsing with fan-out. Extracting a helper module is a clarity win and keeps the DO method focused.
- **Fix:** Created `apps/parrot/workers/lib/vapid.ts` exposing `buildVapidAuthHeader({ endpoint, publicKey, privateKeyPem, subject? })`. Pure function, no DO/Worker coupling, easy to unit-test later.
- **Files modified:** `apps/parrot/workers/lib/vapid.ts` (new)
- **Verification:** TypeScript clean; method imported and called from `sendPushToSubscriptions` in `durableObject/index.ts`.
- **Committed in:** `41818a2` (Task 1 commit)

**2. [Rule 3 - Blocking] Added `app/lib/api.ts` modifications (not in plan's `files_modified`)**
- **Found during:** Task 2 (WorkspaceShell needs typed `api.getNotifications` + `api.markNotificationsRead`)
- **Issue:** The plan's `files_modified` lists Worker-side routes but not the client-side `api` helper that the drawer consumes. The drawer cannot type-safely call the routes without the new types.
- **Fix:** Added `NotificationItem` + `NotificationsResponse` interfaces and 4 new helpers (`getNotifications`, `markNotificationsRead`, `subscribePush`, `unsubscribePush`) to `apps/parrot/app/lib/api.ts`.
- **Files modified:** `apps/parrot/app/lib/api.ts`
- **Verification:** TypeScript clean; consumed from WorkspaceShell's `useQuery` + drawer mutation.
- **Committed in:** `e369ddd` (Task 2 commit)

**3. [Rule 1 - Bug] Push trigger emit only on NEW urgent todo (not dedupe re-insert)**
- **Found during:** Task 1 (wiring `insertTodos` urgency hook)
- **Issue:** The plan says "after inserting todos, iterate the inserted rows; for each row where `urgency_score >= 70`, call sendPush". But `INSERT OR IGNORE` on the `(source_channel, source_id)` unique index can silently skip re-inserts (e.g., a Mattermost re-poll re-extracts the same post). Without dedup, every alarm cycle would re-push the same urgent todo.
- **Fix:** Before each insert, peek the table with `SELECT 1 FROM todos WHERE source_channel = ? AND source_id = ?`. Only queue a push if the row was NOT already present. This preserves the "push fires once per real urgent todo" semantic.
- **Files modified:** `apps/parrot/workers/durableObject/index.ts` (insertTodos)
- **Verification:** Logic inspected; smoke endpoint exercises store/read/mark-read paths.
- **Committed in:** `41818a2` (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (2 blocking — necessary file additions to plan scope; 1 bug — push dedupe).
**Impact on plan:** All three deviations preserve plan intent. No scope creep; only the minimum supporting files (vapid helper + client API types) were added. The dedupe fix protects against an obvious notification-spam regression on alarm re-polls.

## Issues Encountered

- **Migrations file had mixed tab indentation inside the trailing `]`.** First `Edit` attempt failed string match because the closing `	},\n];` used a tab-leading `},` line. Resolved by reading raw bytes via `od -c` and matching on the actual tab-prefixed text.
- **Stray `</str></invoke>` markup accidentally injected into `types.ts`** during the Omit-list edit. Caught immediately by the next `Read` and removed in a follow-up `Edit`. TypeScript would have failed, so the post-edit `tsc --noEmit` would have caught it regardless.

## Authentication Gates

None encountered. VAPID key provisioning is a deferred user action (documented in plan's `pre_execution_user_actions`) — the code path degrades gracefully when keys are absent, so execution did not need to pause.

## User Setup Required

**Before live browser push works in production**, the operator must:

1. Generate a VAPID keypair (PKCS#8 PEM private key):
   ```bash
   # Either via web-push CLI (writes JSON with publicKey + privateKey)
   npx web-push generate-vapid-keys --json > /tmp/vapid-keys.json
   # Or via openssl (writes PKCS#8 PEM directly)
   openssl ecparam -genkey -name prime256v1 -noout -out /tmp/vapid-priv.pem
   openssl pkcs8 -topk8 -in /tmp/vapid-priv.pem -out /tmp/vapid-priv-pkcs8.pem -nocrypt
   ```
2. Paste the `publicKey` (base64url) into `apps/parrot/wrangler.jsonc` `vars.PUSH_VAPID_PUBLIC_KEY`.
3. Upload the PKCS#8 PEM private key as a secret:
   ```bash
   cd apps/parrot && wrangler secret put PUSH_VAPID_PRIVATE_KEY
   ```
4. Also persist the private key in Infisical at `/internjobs-ai/PUSH_VAPID_PRIVATE_KEY` (per the project's secrets-to-Infisical convention).

Until then, the drawer continues to work end-to-end (notifications still land in the table); only the live `Notification.showNotification` fan-out is suppressed with a `console.warn`.

## Next Phase Readiness

- **13-02 (cross-pane actions)** — can store notification rows from actor-driven events (e.g., "Maya sent your email" cross-pane confirmations) using the same `addNotification` method.
- **13-03 (onboarding wizard)** — the SW is registered on every WorkspaceShell mount, so the wizard's push-opt-in toggle can immediately call `navigator.serviceWorker.ready` → `pushManager.subscribe({ applicationServerKey })` → `api.subscribePush()`. The wizard needs to fetch the public key from a new `GET /api/push/vapid-public-key` endpoint (not built here — flagged for 13-03 because it's wizard-coupled).
- **v1.3 follow-up** — implement RFC 8291 aes128gcm body encryption when we start sending PII-sensitive notification bodies (e.g., DM previews, deal-amount alerts).

---
*Phase: 13-cross-pane-launch-polish*
*Plan: 01*
*Completed: 2026-05-19*
