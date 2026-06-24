---
phase: 31-native-chat-client-build-out
plan: "06"
subsystem: chat
tags: [mattermost, vitest, fly-secrets, personal-access-tokens, uat, hardening, cloudflare-workers]
status: uat-pending

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

## Operator Steps — COMPLETED 2026-06-19

Executed by the operator after merging `integration/v1.4` into the branch (chat + email together, conflict in ROADMAP.md only, resolved; `tsc` clean, 67 tests green):

1. **CHAT-HARD-01 — Fly secret hygiene** ✓ (checkpoint #1 satisfied):
   - `flyctl secrets set MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true --stage` then `flyctl secrets unset MM_SERVICESETTINGS_ENABLEPERSONALACCESSTOKENS` (single restart). The stray var was the **prefixed** `MM_SERVICESETTINGS_ENABLEPERSONALACCESSTOKENS` (no such MM setting — the real one is `EnableUserAccessTokens`), which is why prod PAT minting never worked before.
   - Verified: `flyctl secrets list` shows `MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS` present and `...ENABLEPERSONALACCESSTOKENS` absent; MM ping `https://chat.internjobs.ai/api/v4/system/ping` → `200 {"status":"OK"}`; Fly health check passing (machine `6e820d55b13648`, version 11).
2. **Deploy** ✓: `CLOUDFLARE_ACCOUNT_ID=0fffd3dc637bdb26d4963df445a69fd3 npm run deploy` — Worker `internjobs-parrot` **Version `41889c8e-38fb-4ca9-97d9-72d08f097746`** live on `workspace.internjobs.ai`.
3. **Production token backfill** ✓: `POST /api/admin/chat/backfill-tokens` with an operator (CEO) Clerk session JWT → **`{"minted":3,"skipped":0,"failed":0}`**. PAT minting confirmed working in production.

## What Remains (live UAT only)

4. **CHAT-HARD-03 — Employee UAT** (checkpoint #2): the 15-step production walkthrough at `https://workspace.internjobs.ai/chat` (send/reply/DM/group-DM/file/search/react/@mention/WS-real-time/typing/presence/offline-email), incl. the nginx WebSocket-upgrade check (set `MATTERMOST_WS_URL` override only if WS upgrade is blocked). This genuinely requires a logged-in employee browser session and is the only outstanding item before the phase is fully verified.

## Deviations from Plan

None — the autonomous portion executed exactly as written. Test assertions use the `[401, 403]` + `not 404/500` contract because the inner `app` harness has no Clerk wrapper (documented in `workers/tests/helpers.ts`); this matches the existing route-smoke convention rather than asserting 200.

## Known Gaps

- PAT periodic rotation deferred to a future phase (401-triggered re-mint is the only rotation today).

## Status

**UAT-PENDING.** Autonomous tests committed (`98ffbec`). Infra checkpoint #1 (Fly secret hygiene) + production deploy (`41889c8e`) + token backfill (`minted:3, failed:0`) all completed and verified 2026-06-19. The only remaining item is the live 15-step employee UAT (checkpoint #2), which needs a logged-in employee browser session. Once UAT passes, flip this to complete and run `/rrr:submit-phase 31 --team team-workspace`.
