---
phase: 31-native-chat-client-build-out
plan: "01"
subsystem: chat
tags: [mattermost, pat, durable-object, cloudflare-workers, react, identity]

# Dependency graph
requires:
  - phase: 25/native-chat-provisioning
    provides: auto-created MM shadow accounts + /api/chat/* bootstrap + ChatPane
provides:
  - Per-employee Mattermost personal access token (PAT) stored in WorkspaceDO (migration 3_mm_tokens)
  - mintMmUserToken + mmFetchAsUser helpers (admin-mint, user-proxy, 401 re-mint)
  - /api/chat/posts authors human messages AS the real MM user (no parrot_author_* props)
  - Operator-gated /api/admin/chat/backfill-tokens endpoint
  - ChatPane hybrid authorship renderer (legacy bot props vs PAT user_id)
affects:
  - 31-02 channels+threads (channels-as-user needs the PAT)
  - 31-03 DMs (DMs must post as the participant)
  - 31-05 WebSocket real-time (WS authentication_challenge sends the user's own token)
  - 31-06 hardening/UAT (sets MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true + prod backfill)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dependency-injected token resolution (getToken/setToken) keeps mattermost.ts free of DO coupling"
    - "Lazy PAT provisioning on first send + idempotent admin backfill"
    - "401-triggered PAT re-mint and single retry"

key-files:
  created:
    - apps/parrot/workers/tests/lib/mattermost-pat.test.ts
  modified:
    - apps/parrot/workers/durableObject/workspace.ts
    - apps/parrot/workers/lib/mattermost.ts
    - apps/parrot/workers/index.ts
    - apps/parrot/app/components/ChatPane.tsx

key-decisions:
  - "PAT stored as an encrypted-at-rest-by-DO column on the existing employees table (migration 3_mm_tokens), not KV/Clerk metadata — single source of truth alongside the rest of employee state"
  - "mattermost.ts stays DO-agnostic: mmFetchAsUser takes getToken/setToken callbacks rather than importing WorkspaceDO"
  - "Hybrid authorship retained: createMmParrotPost stays for bot/agent/cross-pane messages; human posts use the employee PAT"

patterns-established:
  - "mmFetchAsUser: resolve PAT → call → on 401 re-mint+persist+retry"
  - "ChatPane renderer branches on parrot_author_name presence (legacy) vs post.user_id lookup (PAT)"

# Metrics
duration: 6min
completed: 2026-06-19
---

# Phase 31 Plan 01: Per-user Mattermost PAT Identity Summary

**Every provisioned employee now gets their own Mattermost personal access token stored server-side in WorkspaceDO, and the Worker proxies human chat posts as the real MM user instead of the parrot bot — the architectural unlock for channels-as-user, DMs, and real-time WS in Waves 1-5.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-19T14:19:48Z
- **Completed:** 2026-06-19T14:26:10Z
- **Tasks:** 3 of 3
- **Files modified:** 4 (+1 test file)

## Accomplishments
- WorkspaceDO migration `3_mm_tokens` adds nullable `mm_user_id` + `mm_access_token` columns plus `getEmployeeToken` / `setEmployeeToken` methods.
- `mintMmUserToken` + `mmFetchAsUser` helpers in mattermost.ts; `mmFetch` exported for reuse by the future WS proxy. 401 re-mint/retry path implemented.
- `/api/chat/posts` refactored to post via the employee PAT (human posts carry no `parrot_author_*` props); lazy PAT provisioning on first send; operator-gated `/api/admin/chat/backfill-tokens` returns `{ minted, skipped, failed }`.
- ChatPane post renderer updated to a hybrid model: legacy bot-proxied posts (parrot_author_*) and PAT-authored posts (real `user_id`) both render correctly during the transition.

## Task Commits

Each task was committed atomically:

1. **Task 1: WorkspaceDO migration + token methods** - `b483370` (feat)
2. **Task 2: mintMmUserToken + mmFetchAsUser helpers** - `778e4c2` (feat)
3. **Task 3: chat posts PAT refactor + backfill + ChatPane renderer + tests** - `2e58e74` (feat)

**Plan metadata:** `<this commit>` (docs: complete plan)

## Files Created/Modified
- `apps/parrot/workers/durableObject/workspace.ts` - migration 3_mm_tokens; getEmployeeToken/setEmployeeToken; EmployeeRecord optional PAT fields.
- `apps/parrot/workers/lib/mattermost.ts` - exported mmFetch; added mintMmUserToken + mmFetchAsUser (401 re-mint).
- `apps/parrot/workers/index.ts` - resolveEmployeeToken helper; /api/chat/posts via mmFetchAsUser; /api/admin/chat/backfill-tokens (operator-gated, production-gate comment).
- `apps/parrot/app/components/ChatPane.tsx` - hybrid authorship renderer (495 lines).
- `apps/parrot/workers/tests/lib/mattermost-pat.test.ts` - 5 unit tests for mint + 401 re-mint/retry + not-provisioned.

## Verification

- `npx tsc -b` in apps/parrot: zero errors.
- `npm test` (vitest): 15 tests pass across 7 files (5 new PAT tests + 10 existing, zero regressions).
- `npm run typecheck` (cf-typegen + react-router typegen + tsc -b) NOT run in full: cf-typegen/react-router typegen require wrangler/codegen that may touch network; `tsc -b` (the compile step) was run directly and passes. This is the meaningful type-correctness signal for the changed code.
- Local dev smoke (POST /api/chat/posts / backfill against a live MM) and `chrome_visual_check` / `playwright` from the plan's verification surface were NOT executed in this sandbox — no local MM instance with `MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true` and no browser/Clerk prod session available. The 401 re-mint, mint-disabled (501→null), success, and not-provisioned paths are covered by unit tests instead.

## Deviations from Plan

### Extra file (beyond frontmatter files_modified)
- `apps/parrot/workers/tests/lib/mattermost-pat.test.ts` — added to satisfy the plan's `unit_tests` verification step and prove the 401 re-mint/retry path called out in must_haves. Not destructive; pure new test coverage.

### Type guards added (Rule 2 - missing critical)
- `MATTERMOST_BOT_TOKEN` and `MATTERMOST_ADMIN_TOKEN` are optional (`?: string`) in `Env`. Added explicit null guards in `resolveEmployeeToken`, the `/api/chat/posts` handler, and the backfill endpoint so the helpers receive non-undefined tokens (return 503 `chat_not_provisioned` / `mattermost_admin_not_configured` when unset). Required for type-correctness and graceful degradation.

## Production Gate / Deferred

- PAT minting requires `MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true` on the internjobs-mattermost Fly app. This is **deferred to plan 31-06 Task 1**. Until then, `mintMmUserToken` returns null (MM 501) and `/api/admin/chat/backfill-tokens` MUST NOT be run against production (all employees would land in `failed`). A code comment documents this gate at the endpoint.
- No production deploy / `wrangler deploy` was performed (per critical environment note + the known CLOUDFLARE_ACCOUNT_ID no-op gotcha). Code + commits + tests only.

## Notes for Next Plan
- Wave 1+ should call `mmFetchAsUser` for any channel/DM REST action that must be authored by the human, wiring the same `() => resolveEmployeeToken(c)` / `setEmployeeToken` callbacks.
- The exported `mmFetch` is the intended primitive for the Wave 4 WebSocket proxy.
- Repo layout reminder: the live git repo is the nested `internjobs-marketing-website/` (branch `rrr/v1.4/team-workspace-31`); the outer `Internjobs cms` dir is a separate empty repo. All commits for this plan were made in the nested repo.
