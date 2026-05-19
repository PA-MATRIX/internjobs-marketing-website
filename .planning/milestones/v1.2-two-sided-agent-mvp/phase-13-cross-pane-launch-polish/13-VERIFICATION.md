---
phase: 13-cross-pane-launch-polish
verified: 2026-05-19T00:00:00Z
status: gaps_found
score: 14/15 must-haves verified
gaps:
  - truth: "/healthz returns { ok, mattermost_reachable, ai_gateway_reachable, mailbox_count }"
    status: failed
    reason: "The /healthz handler returns only { mattermost_reachable, ai_gateway_reachable, mailbox_count } — the `ok` field is absent."
    artifacts:
      - path: "apps/parrot/workers/index.ts"
        issue: "Line 190: c.json({ mattermost_reachable, ai_gateway_reachable, mailbox_count }) — missing ok field"
    missing:
      - "Add `ok: true` to the /healthz JSON response so callers and uptime monitors can use a single boolean gate"
advisories:
  - key: "ai-gateway-quota-null-check-dead-code"
    insight: "extractTodosFromText() return type is Promise<ExtractedTodo[]> (never null), but DO code checks `extracted === null` for quota-exceeded audit logging — that branch can never fire. Audit events for ai_gateway_quota_exceeded are silently dropped on 429."
    severity: warning
human_verification:
  - test: "OnboardingWizard renders and completes in browser"
    expected: "Modal appears on first login (onboarded_at null), all three steps render, push opt-in calls navigator.serviceWorker.ready + PushManager.subscribe(), Finish POSTs /api/onboarding/complete and hides the modal."
    why_human: "Push API and serviceWorker APIs are browser-only; full wizard flow requires a live Clerk session and browser interaction."
  - test: "Notification bell badge and drawer"
    expected: "Bell icon shows unread count badge; clicking opens drawer with notification rows; opening the drawer auto-marks all unread after 600ms."
    why_human: "Requires a live browser session with actual notification rows in the DO."
  - test: "Browser push delivery end-to-end"
    expected: "With VAPID keys configured, an inbound starred email fires a browser push notification to a subscribed device."
    why_human: "Requires real VAPID keys provisioned and a live browser PushSubscription endpoint."
  - test: "EmailToChat navigates to /chat with session-stashed channel URL"
    expected: "Button posts /api/crosspane/email-to-chat; on success, channel_url is stored in sessionStorage and the browser navigates to /chat."
    why_human: "Requires live Mattermost instance (MATTERMOST_BOT_TOKEN + MATTERMOST_URL) to complete the happy path."
---

# Phase 13: Cross-pane Actions + Launch Polish — Verification Report

**Phase Goal:** Email↔Chat↔Meeting cross-pane actions, unified notification pane, browser push notifications, first-login wizard, pilot rollout readiness.
**Verified:** 2026-05-19
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Architectural Context Loaded

- Locked source: `.planning/ROADMAP.md` lines 236–261 (Phase 13 architecture decisions) — relevant clauses:
  - "No new LLM call sites. Push VAPID signing uses `crypto.subtle` (Workers built-in) — no `web-push` npm package."
  - "StartMeeting CTA is a UI seam: shows 'Meetings coming soon' toast + writes audit notification row. Daily.co NOT called."
  - "Push subscriptions + notifications stored in EmployeeMailboxDO via migration `4_notifications_push`."
  - "Feature flags: KV namespace `PARROT_FEATURE_FLAGS` holds global defaults; per-employee overrides in `feature_flags` column from migration `5_onboarding_flags`."
  - "Service worker at /sw.js is push-only: handles push + notificationclick, DOES NOT intercept fetch."
  - "NOT installed: `@daily-co/*`, `@cloudflare/voice`, `agents`, `@telnyx/*`, `web-push`."

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Migration 4 (notifications + push_subscriptions) present | VERIFIED | `migrations.ts` line 193: name `4_notifications_push`, both tables with correct columns + indexes |
| 2  | Migration 5 (onboarded_at + feature_flags) present | VERIFIED | `migrations.ts` lines 217–236: name `5_onboarding_flags`, two ALTER TABLE statements on profile |
| 3  | Service worker at /sw.js handles push + notificationclick, no fetch intercept | VERIFIED | `public/sw.js` (50 lines): install + activate + push + notificationclick handlers; no `fetch` event listener |
| 4  | VAPID helper uses crypto.subtle, no web-push dep | VERIFIED | `workers/lib/vapid.ts` (102 lines): uses `crypto.subtle.importKey` + `crypto.subtle.sign` with ES256; `web-push` absent from `package.json` |
| 5  | Three push triggers wired (urgent_todo, starred_email, chat_mention) | VERIFIED | `durableObject/index.ts` lines 542, 607, 844: all three event_type values fire `sendPushToSubscriptions()` |
| 6  | Cross-pane API routes present and implemented (not 501 stubs) | VERIFIED | `workers/index.ts` lines 465–533: email-to-chat calls `emailToChat()`, chat-to-email calls `chatToEmail()`, start-meeting writes notification row and returns JSON — all implemented, none return 501 |
| 7  | StartMeeting does NOT call Daily.co | VERIFIED | Grep for `@daily-co` in apps/parrot returns zero source matches (only comments); `start-meeting` handler writes notification row only |
| 8  | OnboardingWizard rendered from root.tsx when onboarded_at IS NULL, 3 steps, dismissable | VERIFIED | `root.tsx` AppShell: `showWizard = !!me && me.onboarded_at === null`; `OnboardingWizard.tsx` (293 lines): steps 1/2/3 rendered, ×-dismiss sets `open(false)` |
| 9  | Feature flag KV binding declared in wrangler.jsonc, code reads lazily with graceful default | VERIFIED | `wrangler.jsonc` lines 114–120: `PARROT_FEATURE_FLAGS` kv_namespaces binding declared; `durableObject/index.ts` `getFeatureFlags()` checks `if (kv && typeof kv.get === 'function')` with default-all-on fallback |
| 10 | /healthz returns { ok, mattermost_reachable, ai_gateway_reachable, mailbox_count } | FAILED | `workers/index.ts` line 190: response is `{ mattermost_reachable, ai_gateway_reachable, mailbox_count }` — `ok` field absent |
| 11 | Sentry hook: reportToSentry() + global app.onError() | VERIFIED | `workers/index.ts` lines 47–84: `reportToSentry()` reads `SENTRY_DSN`, returns early when unset, posts to Sentry Store API; `app.onError()` at line 924 wired to it |
| 12 | PILOT-RUNBOOK.md exists with 4+ sections | VERIFIED | File exists at phase dir; sections: Pre-launch checklist, Feature flag KV setup, Smoke test sequence, Day-1 rollout protocol, Rollback procedure, On-call escalation |
| 13 | Forbidden packages absent | VERIFIED | `package.json` grep for `@cloudflare/voice`, `@telnyx/`, `agents`, `@daily-co`, `web-push` returns no matches |
| 14 | No direct api.cloudflare.com/.../ai/run/ LLM URLs | VERIFIED | The `api.cloudflare.com` URLs in `workers/lib/email.ts` are Email Routing management (not LLM); all LLM calls route through `gateway.ai.cloudflare.com/v1/…/workers-ai/…` in `workers/lib/ai.ts` |
| 15 | TypeScript type check passes (tsc --noEmit returns zero errors) | VERIFIED | `cd apps/parrot && npx tsc --noEmit` produced no output (exit 0) |

**Score:** 14/15 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/parrot/workers/durableObject/migrations.ts` | Migrations 4 + 5 | VERIFIED | Both present at correct positions; SQL matches spec |
| `apps/parrot/public/sw.js` | Push-only service worker | VERIFIED | 50 lines; install/activate/push/notificationclick — no fetch intercept |
| `apps/parrot/workers/lib/vapid.ts` | ES256 crypto.subtle VAPID | VERIFIED | 102 lines; no npm crypto dep; uses Workers built-in |
| `apps/parrot/workers/index.ts` | Cross-pane routes, /healthz, Sentry, smoke endpoints | PARTIAL | All 5 smoke endpoints present and PARROT_DEV_MODE-gated; cross-pane routes implemented; Sentry wired; /healthz missing `ok` field |
| `apps/parrot/workers/durableObject/index.ts` | emailToChat, chatToEmail, push fan-out, 3 triggers | VERIFIED | All DO methods implemented with substantive logic |
| `apps/parrot/app/components/OnboardingWizard.tsx` | 3-step modal, dismissable, push opt-in | VERIFIED | 293 lines; 3 steps; × dismiss; pushManager.subscribe() in step 2 |
| `apps/parrot/app/components/crosspane/EmailToChat.tsx` | Calls API, navigates to /chat | VERIFIED | 57 lines; sessionStorage + navigate("/chat") on success |
| `apps/parrot/app/components/crosspane/ChatToEmail.tsx` | Calls API, opens draft modal | VERIFIED | 138 lines; full compose modal with to/subject/body fields |
| `apps/parrot/app/components/crosspane/StartMeeting.tsx` | Toast only, no Daily.co | VERIFIED | 51 lines; toast message "Meetings coming soon"; no @daily-co import |
| `apps/parrot/app/root.tsx` | OnboardingWizard wired to onboarded_at | VERIFIED | AppShell renders wizard when `me.onboarded_at === null` |
| `apps/parrot/wrangler.jsonc` | PARROT_FEATURE_FLAGS KV binding | VERIFIED | Declared at kv_namespaces[0] with empty id placeholder (user action required) |
| `.planning/milestones/v1.2-two-sided-agent-mvp/phase-13-cross-pane-launch-polish/PILOT-RUNBOOK.md` | Pre-launch checklist, Day-1 rollout, Rollback, On-call escalation | VERIFIED | All 4+ required sections present (6 total) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `WorkspaceShell.tsx` | `/sw.js` | `navigator.serviceWorker.register` in `useEffect` | WIRED | Line 72–78; registers once on mount |
| `WorkspaceShell.tsx` | `/api/notifications` | `api.getNotifications()` in `useQuery` | WIRED | Line 81–88; 30s refetch interval |
| `OnboardingWizard.tsx` | `/api/push/subscribe` | `api.subscribePush(subscription)` | WIRED | Line 115; called after pushManager.subscribe() |
| `OnboardingWizard.tsx` | `/api/onboarding/complete` | `api.completeOnboarding()` via `useMutation` | WIRED | Line 73–84 |
| `root.tsx` | `OnboardingWizard` | `showWizard = !!me && me.onboarded_at === null` | WIRED | Line 115–124 |
| `EmailToChat.tsx` | `/api/crosspane/email-to-chat` | `api.crosspaneEmailToChat(emailId)` | WIRED | Line 22–29 |
| `ChatToEmail.tsx` | `/api/crosspane/chat-to-email` | `api.crosspaneChatToEmail(postId, postBody)` | WIRED | Line 31–36 |
| `StartMeeting.tsx` | `/api/crosspane/start-meeting` | `api.crosspaneStartMeeting()` | WIRED | Line 25–30 |
| `EmployeeMailboxDO.createEmail()` | `sendPushToSubscriptions()` | direct call on starred inbound | WIRED | Line 537–544 |
| `EmployeeMailboxDO.insertTodos()` | `sendPushToSubscriptions()` | fire-and-forget on urgency_score >= 70 | WIRED | Lines 601–609 |
| `EmployeeMailboxDO.pollMattermostNewPosts()` | `sendPushToSubscriptions()` | @mention detection | WIRED | Lines 838–847 |
| `sendPushToSubscriptions()` | `buildVapidAuthHeader()` | imported from `workers/lib/vapid.ts` | WIRED | Line 1262 |
| `getFeatureFlags()` | `PARROT_FEATURE_FLAGS` KV | `this.env.PARROT_FEATURE_FLAGS.get(...)` | WIRED with graceful default | Lines 235–245; degrades to default-all-on when KV unbound |

---

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| Notification drawer with unread badge | SATISFIED | Bell + drawer fully implemented in WorkspaceShell |
| Browser push (urgent_todo, starred_email, chat_mention) | SATISFIED | All 3 triggers wired; VAPID keys are user action |
| Service worker push-only (no cache) | SATISFIED | sw.js verified — no fetch handler |
| EmailToChat cross-pane | SATISFIED | DO method + HTTP route + UI component all wired |
| ChatToEmail cross-pane | SATISFIED | DO method + HTTP route + UI component all wired |
| StartMeeting seam (toast + audit row, no Daily.co) | SATISFIED | Confirmed no Daily.co call under any path |
| First-login wizard (3-step, dismissable) | SATISFIED | OnboardingWizard rendered from root.tsx on onboarded_at IS NULL |
| GET /healthz with 4-field response | PARTIAL | Missing `ok` field in response body |
| 5 smoke endpoints (push, crosspane, onboarding, seed-email, ranking) | SATISFIED | All 5 registered and PARROT_DEV_MODE-gated |
| PILOT-RUNBOOK.md with required sections | SATISFIED | 6 sections covering all required areas |
| Forbidden packages absent | SATISFIED | `@daily-co`, `web-push`, `@cloudflare/voice`, `agents`, `@telnyx/*` all absent |

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `workers/lib/ai.ts` | `extractTodosFromText` return type is `Promise<ExtractedTodo[]>` (never null) but DO caller checks `extracted === null` | Warning | `ai_gateway_quota_exceeded` audit event branch is dead code — quota-exceeded events on 429 are silently dropped. Does not block goal. |
| `workers/index.ts:519` | start-meeting uses `event_type: 'urgent_todo'` for a meeting-demand notification | Info | Intentional workaround (noted in code comment): dedicated `start_meeting_requested` type deferred to Phase 11. Correct per Phase 13 locked decision. |

---

### Security Pass (gstack Pass 1 — CRITICAL)

Phase-modified files scanned: `workers/index.ts`, `workers/durableObject/index.ts`, `workers/lib/vapid.ts`, `workers/durableObject/migrations.ts`, `app/root.tsx`, `app/components/OnboardingWizard.tsx`, `app/components/crosspane/StartMeeting.tsx`, `app/components/crosspane/EmailToChat.tsx`, `app/components/crosspane/ChatToEmail.tsx`, `public/sw.js`.

| File | Category | Finding | Severity | Blocks Phase |
|------|----------|---------|----------|--------------|
| `workers/durableObject/index.ts:1083` | SQL & Data Safety | `email.body` from Mattermost POST is sliced to 2000 chars and inserted as the Mattermost seed message — no SQL injection risk (parameterized via `JSON.stringify` into a POST body, not concatenated into SQL). | ADVISORY | No — not an injection vector |
| `workers/durableObject/index.ts:1019–1024` | SQL & Data Safety | Dynamic `IN (${placeholders})` clause is constructed via `ids.map(() => '?').join(',')` and spread as params — parameters are properly bound, no interpolation of user values into SQL text. | ADVISORY | No — correct parameterization |
| `app/components/InboxPane.tsx` | Not a Phase 13 file — no scan needed | — | — | — |

No Pass 1 CRITICAL findings in phase-modified files.

_Pass 2 (INFORMATIONAL) not run. Invoke with `mode: deep-review` to enable._

---

### Human Verification Required

#### 1. OnboardingWizard end-to-end in browser

**Test:** Sign in as a fresh employee (onboarded_at = null). Verify the wizard modal appears. Complete all 3 steps. Step 2: enable push notifications and confirm the browser permission dialog fires. Step 3: click Finish. Verify /api/onboarding/complete is called and the modal disappears. Reload the page — wizard should NOT reappear.

**Expected:** Modal renders on first load; push permission granted → subscription posted to /api/push/subscribe; Finish → POST /api/onboarding/complete → onboarded_at becomes non-null → wizard gone permanently.

**Why human:** Push API and `navigator.serviceWorker.ready` are browser-only; full wizard flow requires a live browser session.

#### 2. Notification bell badge and drawer

**Test:** Trigger a todo extraction with urgency >= 70 (via the seed-email smoke endpoint in dev). Navigate to any workspace pane. Verify the bell icon shows a red dot badge. Click bell — verify the notification drawer opens and lists the notification. Verify the badge clears after ~600ms.

**Expected:** Bell badge appears with correct unread count; drawer shows notification rows with title/body/timestamp; mark-all-read clears the badge on the next poll.

**Why human:** Requires actual notification rows in the DO and visual badge inspection.

#### 3. Browser push end-to-end (with VAPID keys provisioned)

**Test:** After provisioning PUSH_VAPID_PRIVATE_KEY + PUSH_VAPID_PUBLIC_KEY in wrangler secrets, subscribe a browser via the wizard. Trigger a starred inbound email. Verify a browser push notification appears.

**Expected:** Push arrives with title matching the email subject; clicking navigates to /inbox.

**Why human:** Requires real VAPID key pair and live push service endpoint. Cannot verify VAPID JWT signing correctness programmatically against a real push service.

#### 4. EmailToChat live path

**Test:** With MATTERMOST_BOT_TOKEN configured, click "Move to Chat" on an Inbox email. Verify a Mattermost private channel is created with the email body as the seed post. Verify the browser navigates to /chat.

**Expected:** Channel appears in Mattermost with correct name (slugified subject); seed message shows email body; browser lands on /chat.

**Why human:** Requires live Mattermost instance.

---

### Gaps Summary

One gap blocking full spec compliance: the `/healthz` endpoint returns `{ mattermost_reachable, ai_gateway_reachable, mailbox_count }` but the ROADMAP spec and verification focus item 9 require `{ ok, mattermost_reachable, ai_gateway_reachable, mailbox_count }`. The fix is a one-line addition of `ok: true` (or a computed boolean) to the `c.json(...)` call at `workers/index.ts` line 190.

One advisory: the `ai_gateway_quota_exceeded` audit path in `extractTodosFromEmail()` / `extractTodosFromChat()` is unreachable because `extractTodosFromText()` never returns `null` — the 429 case returns `[]` instead. The `if (extracted === null)` guard in the DO is dead code. This does not block any goal-achievement truth (notification drawer, push, todos all work) but the audit trail for quota events is silently absent.

All other requirements — migrations 4 and 5, service worker, VAPID helper with crypto.subtle, three push triggers, cross-pane routes (not stubs), StartMeeting Daily.co guard, OnboardingWizard from root.tsx, feature flag KV with graceful default, Sentry onError hook, PILOT-RUNBOOK.md, forbidden package audit, no direct LLM URLs, and TypeScript type check — are fully verified.

---

_Verified: 2026-05-19_
_Verifier: Claude (rrr-verifier)_
