---
phase: 31-native-chat-client-build-out
plan: "06"
subsystem: chat
tags: [mattermost, vitest, fly-secrets, personal-access-tokens, uat, hardening, cloudflare-workers]
status: checkpoint-pending

# Dependency graph
requires:
  - phase: 31-01
    provides: per-employee MM PAT (WorkspaceDO 3_mm_tokens) + backfill-tokens endpoint + mintMmUserToken
  - phase: 31-02
    provides: /api/chat/channels + /api/chat/posts + thread routes (chatUserProxy employee-PAT proxy)
  - phase: 31-03
    provides: DM/group channels + /api/chat/team-members roster
  - phase: 31-04
    provides: /api/chat/files + /api/chat/search + /api/chat/reactions
  - phase: 31-05
    provides: /api/chat/ws Worker-proxied WebSocket + handleChatWebSocket (426/503 branches) + offline mention email
provides:
  - Vitest route smoke coverage for the native chat surface (chat-token / chat-channels / chat-ws) extending the Phase 27 test floor (CHAT-HARD-02)
affects:
  - Phase 31 close-out / PR to integration branch (once operator Fly secret + production backfill + employee UAT pass)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Route smoke tests assert the auth + mounting contract (401/403, never 404/500) through the inner Hono `app` — the inner app has no Clerk wrapper so requireEmployeeMailbox short-circuits 401; happy paths are covered by lib-level unit tests + live UAT. Same pattern as healthz.test.ts / admin-employees.test.ts."
    - "WS upgrade is split across two test layers: handler branches (426 non-WS, 503 no-PAT) in chat-realtime.test.ts against handleChatWebSocket directly; route auth-gate in chat-ws.test.ts through app.fetch(). A real WS upgrade is UAT-only (no WebSocketPair in Vitest/Node)."

key-files:
  created:
    - apps/parrot/workers/tests/routes/chat-token.test.ts
    - apps/parrot/workers/tests/routes/chat-channels.test.ts
    - apps/parrot/workers/tests/routes/chat-ws.test.ts
  modified: []

decisions:
  - "PAT rotation deferred: Wave 0 implements 401-triggered re-mint; periodic rotation (e.g. 90-day cron) is a known gap left to a future phase (per 31-RESEARCH open question 1)."
  - "Fly secret config MUST use flyctl secrets set MM_SERVICESETTINGS_* — mmctl config set writes the MM DB config which is IGNORED while the MM_* env var is pinned by the Fly deployment (same pattern as mm-oidc-sso-blocked-by-license)."

completed: 2026-06-19 (autonomous portion)
duration: ~25m (autonomous tests + verify + commit)
---

# Phase 31 Plan 06: Hardening + UAT Summary

Wave 5 (final wave) of the native chat client build-out — hardening + verification. One-liner: **Vitest route coverage for the native chat surface landed and green (64 passing); the Fly PAT secret, production token backfill, and employee UAT remain as operator-only actions gated behind two human-verify checkpoints.**

## What Shipped (autonomous)

- **CHAT-HARD-02 — Vitest route coverage** (commit `98ffbec`): three new smoke test files added under `apps/parrot/workers/tests/routes/`, following the established `healthz.test.ts` / `admin-employees.test.ts` pattern (`app.fetch()` against the inner Hono app, assert auth gate + route mounted):
  - `chat-token.test.ts` (4 tests) — `/api/admin/chat/backfill-tokens` operator gate, `/api/chat/posts` PAT-proxy auth gate, `/api/chat/bootstrap` mount (Wave 0).
  - `chat-channels.test.ts` (4 tests) — `/api/chat/channels` GET/POST, `/api/chat/posts/:id/thread`, `/api/chat/search` (Waves 1 + 3).
  - `chat-ws.test.ts` (3 tests) — `/api/chat/ws` auth gate + route-mounted + no-crash-on-upgrade-header contract (Wave 4); 426/503 handler branches already covered in `chat-realtime.test.ts`.
- `npm test` (vitest run): **14 files, 64 tests, all passing.** 11 of those are new.
- `tsc -b`: clean (exit 0).

## What Remains (operator-only — checkpoint-pending)

The following are production / infrastructure actions the executor agent must NOT perform (flyctl, wrangler, live production curl). They satisfy the remaining `must_haves` truths and the two blocking human-verify checkpoints in the plan:

1. **CHAT-HARD-01 — Fly secret hygiene** (Task 1 + checkpoint #1):
   - `flyctl secrets set MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true --app internjobs-mattermost` (restarts MM).
   - Check `flyctl secrets list --app internjobs-mattermost` for a stray `ENABLEPERSONALACCESSTOKENS`; if present, `flyctl secrets unset ENABLEPERSONALACCESSTOKENS --app internjobs-mattermost`.
   - Confirm MM restarted healthy via `flyctl status --app internjobs-mattermost`.
2. **Production token backfill** (Task 2, ONLY after secret confirmed):
   - `POST https://workspace.internjobs.ai/api/admin/chat/backfill-tokens` with an operator session token; expect `{ minted: N, skipped: M, failed: 0 }`. `failed > 0` ⇒ secret not yet active.
3. **Deploy** (if any worker redeploy is needed): operator runs `wrangler deploy` with `CLOUDFLARE_ACCOUNT_ID=0fffd3dc…` pinned (the known silent-no-op gotcha).
4. **CHAT-HARD-03 — Employee UAT** (checkpoint #2): the 15-step production walkthrough (send/reply/DM/group-DM/file/search/react/@mention/WS-real-time/typing/presence/offline-email).

## Deviations from Plan

None — the autonomous portion executed exactly as written. Test assertions use the `[401, 403]` + `not 404/500` contract because the inner `app` harness has no Clerk wrapper (documented in `workers/tests/helpers.ts`); this matches the existing route-smoke convention rather than asserting 200.

## Known Gaps

- PAT periodic rotation deferred to a future phase (401-triggered re-mint is the only rotation today).

## Status

**CHECKPOINT-PENDING.** Autonomous tests committed (`98ffbec`). Final plan-completion docs commit is intentionally deferred until the operator completes the Fly secret + backfill + UAT and the two blocking checkpoints are approved.
