---
phase: 13-cross-pane-launch-polish
plan: 03
subsystem: ui
tags: [onboarding-wizard, feature-flags, kv, healthz, sentry, vapid, web-push, durable-objects, react-router, hono, clerk]

# Dependency graph
requires:
  - phase: 13-01
    provides: notifications + push_subscriptions tables, sendPushToSubscriptions DO method, VAPID inline signer, sw.js, NotificationDrawer in WorkspaceShell
  - phase: 13-02
    provides: crosspane Hono routes + DO methods (emailToChat / chatToEmail / startMeeting), three crosspane components, /api/dev/smoke/crosspane
  - phase: 12-01
    provides: Workers AI via AI Gateway env (CLOUDFLARE_AI_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, PARROT_AI_GATEWAY_ID) — /healthz pings the gateway
  - phase: 10
    provides: EmployeeMailboxDO, profile table, /api/me, root.tsx, useCurrentEmployee
provides:
  - "Migration 5_onboarding_flags (onboarded_at + feature_flags TEXT columns on profile)"
  - "setOnboardedAt / getFeatureFlags / isFeatureEnabled DO methods"
  - "OnboardingWizard 3-step modal component (display name / push opt-in / Mattermost ping)"
  - "GET /healthz public liveness endpoint (Mattermost + AI Gateway + mailbox_count)"
  - "Inline reportToSentry helper (no @sentry/cloudflare dep) + Hono onError global handler"
  - "PARROT_FEATURE_FLAGS KV binding (degrades gracefully when unbound)"
  - "POST /api/onboarding/complete + GET /api/feature-flags + POST /api/dev/smoke/onboarding"
  - "PILOT-RUNBOOK.md (pre-flight + KV setup + smoke + rollout + rollback + on-call)"
affects:
  - "Phase 11 (Daily.co) when it lands — start-meeting handler swaps to /rooms POST without touching wizard"
  - "v1.3 admin console — flag overrides will move from wrangler CLI to UI"
  - "v1.3 RFC 8291 push body encryption"
  - "v1.3 WorkspaceDO.countEmployees() — flips /healthz mailbox_count from -1 to real count"

# Tech tracking
tech-stack:
  added: []   # Zero new npm packages
  patterns:
    - "Per-employee server-side wizard gate (profile.onboarded_at IS NULL) — dismiss is per-visit, completion is per-employee"
    - "Feature flags = global defaults in KV + per-employee overrides in DO JSON column, merged at read time, employee wins"
    - "Default-all-on with explicit-false override (missing key === enabled) — frictionless rollout, surgical kill switch"
    - "Inline minimal Sentry envelope POST (same posture as inline VAPID signer) — no @sentry/cloudflare bundle bloat"
    - "Graceful KV-unbound fallback — getFeatureFlags returns defaults rather than erroring"
    - "Public /healthz NO auth — bypasses Clerk middleware so uptime monitors and pre-launch curls work without tokens"

key-files:
  created:
    - "apps/parrot/app/components/OnboardingWizard.tsx (293 lines)"
    - ".planning/milestones/v1.2-two-sided-agent-mvp/phase-13-cross-pane-launch-polish/PILOT-RUNBOOK.md"
  modified:
    - "apps/parrot/workers/durableObject/migrations.ts (+migration 5_onboarding_flags)"
    - "apps/parrot/workers/durableObject/index.ts (+setOnboardedAt/getFeatureFlags/isFeatureEnabled; EmployeeProfile.onboardedAt)"
    - "apps/parrot/workers/types.ts (+PARROT_FEATURE_FLAGS, SENTRY_DSN env)"
    - "apps/parrot/workers/index.ts (+/healthz, +reportToSentry, +/api/onboarding/complete, +/api/feature-flags, +/api/dev/smoke/onboarding, +app.onError; /api/me returns onboarded_at)"
    - "apps/parrot/wrangler.jsonc (+kv_namespaces[PARROT_FEATURE_FLAGS], +SENTRY_DSN secret comment)"
    - "apps/parrot/app/root.tsx (loader returns vapidPublicKey; AppShell renders OnboardingWizard when me.onboarded_at===null)"
    - "apps/parrot/app/lib/api.ts (MeResponse.onboarded_at; api.getFeatureFlags + api.completeOnboarding)"

key-decisions:
  - "Wizard re-shows per visit until server flag flips — × dismisses session, server is canonical"
  - "Default-all-on feature flags — missing key means enabled, only explicit false disables"
  - "/healthz returns mailbox_count: -1 in v1.2 — placeholder for v1.3 WorkspaceDO.countEmployees()"
  - "Sentry inline (no npm dep) — POST to /api/{projectId}/store/ with X-Sentry-Auth header, fire-and-forget"
  - "VAPID public key threaded via root loader (not a dedicated endpoint) — one fewer round-trip"
  - "AppShell INSIDE QueryClientProvider — useCurrentEmployee needs React Query context"
  - "onboarded_at writable ONLY via setOnboardedAt — upsertProfile intentionally untouched"
  - "Empty KV id committed (user fills after wrangler kv namespace create) — Worker boots regardless"

patterns-established:
  - "Per-visit dismiss + per-employee completion gate (apply to future first-run prompts)"
  - "KV-defaults + DO-overrides merge (apply to per-employee billing tiers, locale, theme, etc.)"
  - "Inline telemetry envelope POSTs (apply to future Datadog, Honeycomb integrations)"
  - "Loader-threaded non-secret env vars (apply to future ANALYTICS_KEY, MAPS_PUBLIC_KEY, etc.)"
  - "AppShell-inside-providers pattern (apply when adding future global modals, e.g. consent banner)"

# Metrics
duration: 7m 1s
completed: 2026-05-19
---

# Phase 13 Plan 03: Cross-pane Actions + Launch Polish (Wave 3) Summary

**First-login OnboardingWizard + KV-backed feature flags + /healthz liveness + inline Sentry — last code-only piece of v1.2 before pilot rollout.**

## Performance

- **Duration:** 7m 1s
- **Started:** 2026-05-19T06:19:31Z
- **Completed:** 2026-05-19T06:26:32Z
- **Tasks:** 2
- **Files modified:** 9 (7 modified + 2 created)
- **Commits:** 2 atomic feat commits on main

## Accomplishments

- **Onboarding wizard ships:** 3-step modal (display name / push opt-in / Mattermost finish) appears for any signed-in employee with `profile.onboarded_at IS NULL`. Dismissable per visit; the server flag is canonical, so it re-appears until `POST /api/onboarding/complete` flips it. Push opt-in uses VAPID public key threaded from the root loader (not a dedicated endpoint), calls `pushManager.subscribe()` against the Wave-1 `/sw.js`, and POSTs to `/api/push/subscribe`.
- **Feature flags via KV + DO column:** Global defaults read from `PARROT_FEATURE_FLAGS` KV (key `global_defaults`), merged with per-employee JSON overrides in `profile.feature_flags`. Employee overrides win. Three canonical flags: `cross_pane`, `push`, `onboarding_wizard`. Default-all-on so missing KV bindings or missing keys don't disable features — kill switch is explicit `false`. Worker boots cleanly when KV is unbound.
- **`/healthz` public probe:** Returns `{ mattermost_reachable, ai_gateway_reachable, mailbox_count }`. No Clerk auth required (so uptime monitors and pre-launch curls work). Mattermost pinged via `/api/v4/system/ping` with 2s timeout. AI Gateway pinged with a 1-token `llama-3.1-8b-instruct` completion via `gateway.ai.cloudflare.com` (the only sanctioned LLM URL pattern in the codebase). `mailbox_count: -1` until v1.3 ships `WorkspaceDO.countEmployees()`.
- **Inline Sentry envelope POST:** Helper `reportToSentry(env, err, ctx)` parses the DSN URL, posts a JSON event to `/api/{projectId}/store/` with `X-Sentry-Auth`, fire-and-forget. No `@sentry/cloudflare` dependency (same posture as the inline VAPID signer in Wave 1). Wired into `app.onError` global Hono handler — every unhandled error gets captured. SENTRY_DSN is OPTIONAL; falls back to `console.error` when absent.
- **PILOT-RUNBOOK.md (canonical pilot reference):** 7 sections — pre-flight checklist (secrets / vars / KV / SW / /healthz), feature flag KV setup (global + per-employee), smoke test sequence (push / crosspane / onboarding / ranking / seed-email / healthz), Day-1 rollout protocol (raj → ridhi → external), rollback procedure (KV flag flip ≤60s, Worker rollback, DNS bypass), on-call escalation (severity ladder + service ownership), and out-of-scope (Daily.co Phase 11, RFC 8291 encryption, Telnyx, admin UI).

## Task Commits

1. **Task 1: Migration 5 + DO methods + /healthz + Sentry + onboarding routes** — `e97bffe` (feat)
2. **Task 2: OnboardingWizard component + root.tsx integration + PILOT-RUNBOOK** — `e0b3e81` (feat)

## Files Created/Modified

- `apps/parrot/workers/durableObject/migrations.ts` — Added migration `5_onboarding_flags` with two NULL-safe `ALTER TABLE profile ADD COLUMN` statements (`onboarded_at TEXT`, `feature_flags TEXT`). NULL-safe means no DEFAULT or UPDATE pass — existing rows interpret as "not onboarded yet", which maps cleanly to "show the wizard next login."
- `apps/parrot/workers/durableObject/index.ts` — Three new DO methods (`setOnboardedAt`, `getFeatureFlags`, `isFeatureEnabled`). `EmployeeProfile.onboardedAt: string | null` added. `getProfile()` SELECTs the new column. `upsertProfile()` intentionally untouched so onboarded_at is only writable via the explicit gate.
- `apps/parrot/workers/types.ts` — `Env.PARROT_FEATURE_FLAGS?: KVNamespace`, `Env.SENTRY_DSN?: string`. Both added to `CfEnvBase` Omit tuple so wrangler-generated literal types don't collide.
- `apps/parrot/workers/index.ts` — Inline `reportToSentry()` helper. `GET /healthz` (public, no auth). `POST /api/onboarding/complete`, `GET /api/feature-flags`, `POST /api/dev/smoke/onboarding` (PARROT_DEV_MODE-gated). `app.onError` global handler. `/api/me` extended to return `onboarded_at`.
- `apps/parrot/wrangler.jsonc` — `kv_namespaces` block declaring `PARROT_FEATURE_FLAGS` (empty id; user fills after `wrangler kv namespace create`). `SENTRY_DSN` secret comment added.
- `apps/parrot/app/lib/api.ts` — `MeResponse.onboarded_at: string | null`. `api.getFeatureFlags()` and `api.completeOnboarding(input)` helpers.
- `apps/parrot/app/root.tsx` — Loader returns `vapidPublicKey` from `env.PUSH_VAPID_PUBLIC_KEY`. New `AppShell` component (inside `QueryClientProvider`) renders `<Outlet />` plus `<OnboardingWizard>` when `me.onboarded_at === null`. Wrapped in both the ClerkProvider branch and the no-Clerk fallback branch.
- `apps/parrot/app/components/OnboardingWizard.tsx` (NEW, 293 lines) — 3-step modal. Inline `urlBase64ToUint8Array` for VAPID key conversion. Push status state machine: idle / requesting / granted / denied / unavailable. Skippable via × button (per-visit dismiss); server-side flag flip is canonical (per-employee completion).
- `.planning/milestones/v1.2-two-sided-agent-mvp/phase-13-cross-pane-launch-polish/PILOT-RUNBOOK.md` (NEW) — Canonical pilot rollout reference: pre-flight + KV setup + smoke test sequence + Day-1 rollout + rollback + on-call + out-of-scope.

## Decisions Made

- **Wizard re-shows per visit until server flag flips.** The × button dismisses the modal for the current page-load only. Next page load (or React Query re-fetch of `/api/me`) will re-render the wizard until `onboarded_at` is non-null. This forces the user to genuinely engage with onboarding rather than dismissing once and never seeing it again, while still being non-blocking (× lets them get to their inbox if they're in a hurry).
- **Default-all-on feature flags.** `isFeatureEnabled('foo')` returns `true` UNLESS the flag is explicitly set to `false`. New features ship enabled by default — flags are a kill switch, not an enablement gate. Friction-free rollout, surgical incident response.
- **`getFeatureFlags()` returns defaults on ANY error.** KV throw, malformed JSON in the override column, missing binding — all fall back to `{cross_pane: true, push: true, onboarding_wizard: true}`. Rationale: over-granting a feature in an incident is recoverable (kill switch); locking everyone out due to a parse error is not.
- **`/healthz` is public (no Clerk auth).** Pre-flight curls and uptime monitors don't have Clerk session cookies. The endpoint only reveals reachability booleans (no PII, no internal state), so this is safe. It is the canonical liveness probe per PILOT-RUNBOOK §1.5.
- **`mailbox_count: -1` placeholder in /healthz.** Counting DO instances across a namespace isn't a primitive; the `WorkspaceDO.countEmployees()` RPC that would make this real is v1.3 work. We surface `-1` so monitors can render "n/a" and we don't have to change the response shape when the count goes live.
- **Inline Sentry, not `@sentry/cloudflare`.** The Sentry Store API accepts a JSON envelope at `/api/{projectId}/store/` with an `X-Sentry-Auth` header — that's all unhandled-error capture needs. Same posture as the inline VAPID signer in Wave 1: when one short fetch can do the job, don't pull in a transitive-dep-heavy SDK. Bundle stays under control.
- **VAPID public key threaded via root loader, not a dedicated endpoint.** The publishable Clerk key is already passed via `useLoaderData` — adding VAPID alongside is one less round-trip than a `GET /api/push/vapid-public-key` call would cost. Both keys are safe-to-ship (Clerk pk_… is designed for client embedding; VAPID public key is literally the public half of a keypair).
- **`AppShell` inside `QueryClientProvider`.** The wizard's gate uses `useCurrentEmployee()` from `~/lib/auth`, which uses React Query. So the wizard host component MUST live inside the provider tree. We added a small inner component rather than restructuring the entire shell.
- **`onboarded_at` is set-only via `setOnboardedAt()`.** `upsertProfile()` was deliberately NOT extended to take `onboardedAt` — the only path to setting it is `POST /api/onboarding/complete`, which calls `setOnboardedAt()`. This prevents accidental resets (e.g., if a future endpoint upserts the profile with stale data, it can't wipe the onboarding flag).
- **Empty KV namespace id committed to wrangler.jsonc.** The user runs `wrangler kv namespace create PARROT_FEATURE_FLAGS --name internjobs-parrot` and pastes the id into the JSON. Until then, the binding is "declared but unbound" — `getFeatureFlags()` handles this gracefully. This decoupling means the merge can land before the user-action completes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `apps/parrot/app/lib/api.ts` updated even though not in frontmatter `files_modified`**
- **Found during:** Task 1 (the plan's `<action>` block for Task 1 explicitly says "api.ts additions" with concrete code, but `files_modified` lists only 6 paths — `api.ts` was implicit)
- **Issue:** The wizard's `completeMutation` calls `api.completeOnboarding(...)` — without the helper, the component would not type-check
- **Fix:** Added `MeResponse.onboarded_at`, `api.getFeatureFlags()`, `api.completeOnboarding()` per plan body
- **Files modified:** apps/parrot/app/lib/api.ts
- **Verification:** TypeScript clean (`npx tsc --noEmit`); plan body explicitly enumerates these additions
- **Committed in:** e97bffe (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking / scope clarification, not scope creep)
**Impact on plan:** Plan's `<action>` body and `files_modified` frontmatter were inconsistent — the action specified work in `api.ts` but the frontmatter omitted it. The action body is the contract; this is documentation drift in the plan, not a scope expansion. All work stayed within plan intent.

## Issues Encountered

- **None.** Plan executed as written. TypeScript was clean after every task. No grep audit hits for forbidden packages (`@daily-co/*`, `@cloudflare/voice`, `@telnyx/*`, `agents`, `web-push`). No new LLM REST URLs (the only LLM call is `gateway.ai.cloudflare.com/v1/.../workers-ai/...` in `/healthz`, which is the sanctioned AI Gateway pattern).

## User Setup Required

Three user-actions gate the full feature set going live. Code degrades gracefully without any of them — the Worker boots, the wizard renders, the drawer works.

1. **Create KV namespace** (Phase 13 Wave 3):
   ```bash
   wrangler kv namespace create PARROT_FEATURE_FLAGS --name internjobs-parrot
   # Paste the id into apps/parrot/wrangler.jsonc kv_namespaces[0].id
   ```
   Until this lands: `getFeatureFlags()` returns the default-all-on map (every feature enabled). Acceptable for pilot.

2. **Provision Sentry** (Phase 13 Wave 3):
   - sentry.io → New Project → Cloudflare Workers → copy DSN
   - `wrangler secret put SENTRY_DSN`
   - Store at Infisical `/internjobs-ai/SENTRY_DSN`
   Until this lands: unhandled errors fall back to `console.error` (visible via `wrangler tail`).

3. **Provision VAPID keypair** (Phase 13 Wave 1 — still pending if not done):
   - `npx web-push generate-vapid-keys --json`
   - Paste publicKey into `wrangler.jsonc` `vars.PUSH_VAPID_PUBLIC_KEY`
   - `wrangler secret put PUSH_VAPID_PRIVATE_KEY` (PKCS#8 PEM private half)
   Until this lands: wizard's step 2 toggle is disabled with "Push not available" copy; notification rows still land in the drawer.

The full canonical checklist is in PILOT-RUNBOOK.md §1.

## Next Phase Readiness

- **Phase 13 is code-complete.** All three waves shipped. With this plan, v1.2's Phase 13 (Cross-pane Actions + Launch Polish) is closed.
- **v1.2 milestone is code-complete.** Phase 11 (Daily.co) is DEFERRED per user direction 2026-05-19 — the Wave 2 start-meeting handler is the UI seam that records pilot demand. All other v1.2 phases (01-06, 07, 07b, 08, 09, 10, 12, 13) are shipped to production code.
- **Remaining work is user-actions only:**
  - VAPID keypair generation + secrets (Phase 13 Wave 1 gate)
  - KV namespace creation + id paste (Phase 13 Wave 3 gate)
  - Sentry DSN provisioning (Phase 13 Wave 3 gate, optional)
  - CF AI Gateway provisioning + 3 secrets (Phase 12 gate)
  - Mattermost bot token (Phase 12 gate)
  - DNS proxy fix, Clerk key rotation, Clerk strategy enablement, operator publicMetadata (Phases 01-06)
  - CF Email Routing setup (Phase 03 gate)
  - INTEG-01 11-step prod smoke test (Phase 06 gate)
- **First pilot rollout target:** raj (self) → ridhi (CEO) → external pilots, per PILOT-RUNBOOK §4.1.
- **Carryover SEC-ROTATE backlog:** Cloudflare Email Service token (SEC-ROTATE-CF-EMAIL-01), Cloudflare Workers AI token (SEC-ROTATE-CF-AI-01), CF AI Gateway / parrot token (SEC-ROTATE-CF-AI-PARROT-01). All non-blocking for pilot launch; rotate post-INTEG-01.
- **v1.3 follow-ups flagged from this wave:**
  - `WorkspaceDO.countEmployees()` RPC → flips `/healthz` `mailbox_count` from -1 to real count
  - RFC 8291 aes128gcm push body encryption (currently unencrypted JSON — acceptable for v1.2 since titles/bodies carry no PII)
  - Admin console UI for flag overrides + per-employee DO surgery (currently wrangler CLI only)
  - `POST /api/admin/employees/:id/flags` endpoint to write per-employee `profile.feature_flags` overrides

---
*Phase: 13-cross-pane-launch-polish*
*Completed: 2026-05-19*
