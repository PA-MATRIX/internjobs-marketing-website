---
phase: 31-native-chat-client-build-out
plan: "03"
subsystem: chat
tags: [mattermost, dms, group-dms, pat, cloudflare-workers, react, react-query]

# Dependency graph
requires:
  - phase: 31-01
    provides: per-employee MM PAT (WorkspaceDO 3_mm_tokens) + mmFetchAsUser (401 re-mint) + resolveEmployeeToken
  - phase: 31-02
    provides: chatUserProxy(c) employee-PAT proxy helper + ChatPane secondaryNav channel browser + /api/chat/posts (PAT-authored)
provides:
  - Worker DM routes — GET /api/chat/dms (enriched dm_partner_names), POST /api/chat/dms/direct, POST /api/chat/dms/group (all as employee PAT)
  - Worker GET /api/chat/team-members — bot-token team roster (minus self) for the new-DM user picker, 60s cache
  - mattermost.ts helpers — createMmDirectChannel, createMmGroupChannel, getMmMyDirectChannels (filter type D/G)
  - ChatPane Direct Messages section in the secondaryNav rail + NewDmDialog user picker (direct + group)
affects:
  - 31-04 files/search/reactions/@mentions (DM channels are now first-class message surfaces these hang off)
  - 31-05 WebSocket real-time (DM list + has_unreads dot become WS-driven)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DM/group channels post + read through the SAME /api/chat/posts + /api/chat/channels/:id/posts routes as regular channels — the redundant 'channel in team list' gate was relaxed; PAT scoping (post) / a members/me check (read) enforce real membership instead"
    - "Direct ('D') channel partner id derived from the channel name (`idA__idB`) to avoid a per-channel members lookup; only group ('G') DMs need a members fetch"
    - "DM list is a separate useQuery (['native-chat','dms']) from channels; both render into the one WorkspaceShell secondaryNav rail under labelled sub-headers (Channels / Direct Messages)"

key-files:
  created:
    - apps/parrot/workers/tests/lib/mattermost-dms.test.ts
  modified:
    - apps/parrot/workers/lib/mattermost.ts
    - apps/parrot/workers/index.ts
    - apps/parrot/app/components/ChatPane.tsx

key-decisions:
  - "Relaxed the channel-membership gate on /api/chat/posts (drop it; PAT-scoped post is self-authorizing — MM 403s a non-member) and on /api/chat/channels/:id/posts (fall back to a GET /channels/:id/members/me check via the employee PAT) so DM channels — which are NOT in the team-channel bootstrap list — can be read + posted to without a new route."
  - "DM routes proxy via chatUserProxy/mmFetchAsUser (employee PAT) so the DM + its messages belong to the real MM user; the new mattermost.ts helpers (createMmDirectChannel/createMmGroupChannel/getMmMyDirectChannels) are exported + unit-tested but the routes call mmFetchAsUser inline to keep the Wave-0 401 re-mint — same posture as 31-02."
  - "Partner-name resolution uses the BOT token (read-only batch getMmUsersByIds) while the channel create/list use the employee PAT — bot has read access and avoids extra PAT round-trips for display names."
  - "Group-DM creation adds the employee's own mm_user_id server-side and validates the final list is 3–8 (MM's group-channel constraint); the client sends only the other 2+ selected ids."

patterns-established:
  - "Reuse the existing /api/chat/posts route for DM composing by passing the DM channel_id — no DM-specific send route (per plan key_links)."
  - "NewDmDialog: search input + checkbox multi-select over /api/chat/team-members; 'Direct Message' enabled at exactly 1 selection, 'Group DM' at 2+."

# Metrics
duration: 9min
completed: 2026-06-19
---

# Phase 31 Plan 03: DMs + Group DMs Summary

**Employees can now start direct and group DMs with anyone in the org from a searchable user picker in the Chat tab; DMs live in their own "Direct Messages" section of the Workspace secondary-nav with resolved partner names, and every DM message is authored AS the real Mattermost user (never the parrot bot) by reusing the Wave-0 PAT through the existing post route.**

## Performance

- **Duration:** ~9 min
- **Tasks:** 2 of 2
- **Files modified:** 3 (+1 test file)

## Accomplishments

- **3 new `mattermost.ts` helpers** — `createMmDirectChannel` (POST /api/v4/channels/direct), `createMmGroupChannel` (POST /api/v4/channels/group), `getMmMyDirectChannels` (GET /api/v4/users/me/channels, filtered to type "D" + "G") — with **8 unit tests** (method/path/body shape, the D/G filter, idempotency, failure → null/[]).
- **4 new Worker routes** in `index.ts`, all `requireEmployeeMailbox`:
  - `GET /api/chat/dms` — lists the employee's DM channels via their PAT, then enriches each with `dm_partner_names` (direct-channel names parsed from the `idA__idB` channel name; group-channel members fetched + batch-resolved through the bot token).
  - `POST /api/chat/dms/direct` — body `{ mm_user_id }`; opens/creates the DM with `[employee.mmUserId, partnerId]` (idempotent), rejects self-DM.
  - `POST /api/chat/dms/group` — body `{ mm_user_ids: string[] }`; adds the employee server-side, validates 3–8 total, creates the group channel.
  - `GET /api/chat/team-members` — bot-token team roster (`GET /api/v4/teams/{id}/members` + batched `getMmUsersByIds`), excludes the requester, `Cache-Control: private, max-age=60`.
- **Membership-gate relaxation** so DMs work through existing routes: `POST /api/chat/posts` drops the "channel must be in the team list" check (PAT-scoped post is self-authorizing); `GET /api/chat/channels/:id/posts` falls back to a `GET /channels/:id/members/me` PAT check for non-team channels before reading with the bot token.
- **ChatPane** gained a **Direct Messages** section in the secondaryNav (avatar initials for direct / `Users` icon for group, partner name labels, `has_unreads` dot placeholder, "+" to open the picker), a separate `["native-chat","dms"]` query polling 30s, DM-aware header title + composer placeholder, and the **`NewDmDialog`** user picker (search over `/api/chat/team-members`, checkbox multi-select, "Direct Message" at exactly 1 / "Group DM" at 2+, invalidates the DM list + switches active channel on success).

## Task Commits

1. **Task 1: DM Worker routes + mattermost.ts DM helpers** — `fab0e51` (feat)
2. **Task 2: ChatPane DM section + user picker dialog** — `f2da5c6` (feat)

**Plan metadata:** `<this commit>` (docs: complete plan)

## Files Created/Modified

- `apps/parrot/workers/lib/mattermost.ts` — added `createMmDirectChannel`, `createMmGroupChannel`, `getMmMyDirectChannels` (all take a bearer token directly).
- `apps/parrot/workers/index.ts` — imports for the new helpers + `mmFetch` + `MattermostUser`; 4 new `/api/chat/*` routes (dms list, direct, group, team-members); relaxed membership gates on the posts read + send routes.
- `apps/parrot/app/components/ChatPane.tsx` — DM section in secondaryNav, DM query + `openDm` mutation, DM-aware header/placeholder, `NewDmDialog`, `dmLabel`/`initials`/`mmUserDisplayName` helpers (1461 lines).
- `apps/parrot/workers/tests/lib/mattermost-dms.test.ts` — 8 unit tests for the 3 new DM helpers.

## Verification

- `npx tsc -b` in apps/parrot: **zero errors** (run after Task 1 and Task 2).
- `npx react-router build`: **succeeds** (client + SSR bundles; `chat-B-24Y3PJ.js` 33.56 kB, gzip 8.45 kB — up from 26.28 kB in Wave 1).
- `npx vitest run`: **37 tests pass across 9 files** (8 new DM-helper tests + 29 existing, zero regressions).
- `npm run typecheck` (package script) NOT run in full — it chains `cf-typegen` (wrangler) + `react-router typegen` which can touch network/codegen in this sandbox; the meaningful compile signal (`tsc -b`) + the real `react-router build` were both run directly and are clean. Same posture as 31-01/31-02.
- Browser `chrome_visual_check` / Playwright from `verification.surface: ui_affecting` were NOT executed in this sandbox — no live MM instance with `MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true` and no browser/Clerk prod session. The successful build (component tree compiles + renders) plus the helper unit tests are the substitute. Live visual verification is deferred to plan 31-06 UAT (consistent with the phase's deploy gate).

## Deviations from Plan

### Helpers exported but DM routes proxy inline (design choice, not a gap)
Same as 31-02: the new `createMmDirectChannel`/`createMmGroupChannel`/`getMmMyDirectChannels` helpers take a **raw token** and would bypass the Wave-0 401 re-mint. So the routes call `mmFetchAsUser` (via `chatUserProxy`) inline to stay self-healing, while the helpers are still **exported** (must_haves `exports` contract) and covered by 8 unit tests. Both goals met.

### Membership-gate relaxation on the shared post/read routes (Rule 3 — blocking)
The plan says DM posting reuses the existing `POST /api/chat/posts` route. But that route (and `GET /api/chat/channels/:id/posts`) gated on "channel_id is in the team-channel bootstrap list" — DM/group channels are never in that list, so DM posting/reading would have 403'd. Fixed by dropping the redundant gate on the send route (PAT-scoped post self-authorizes; MM 403s a non-member) and replacing it with a `members/me` PAT check on the read route. This was required to make the plan's stated DM-via-/api/chat/posts flow actually work.

### team-members route placement (clarification, not a deviation)
The plan's Task 2 prose debated several options for the user-picker roster source and concluded with `GET /api/chat/team-members` using the bot token + `GET /api/v4/teams/{id}/members` + batch user lookup — that is exactly what was built. The route was added in Task 2's surface but lives in `index.ts` (a Task-1 file) — committed under Task 1's commit since both touch `index.ts`... actually it was added in the Task 1 edit pass alongside the DM routes (one coherent index.ts change) and is therefore in commit `fab0e51`. No functional difference.

## Authentication Gates

None. No CLI/API auth prompts were hit (no deploy, no live MM calls — code + build + vitest only).

## Production Gate / Deferred

- All DM operations depend on the employee PAT, which requires `MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true` on the internjobs-mattermost Fly app — **deferred to plan 31-06 Task 1**. Until then `resolveEmployeeToken` returns null and the DM routes return `503 chat_not_provisioned`; ChatPane surfaces the friendly reason copy.
- No production deploy / `wrangler deploy` was performed (per critical-environment note + the `CLOUDFLARE_ACCOUNT_ID` no-op gotcha). Code + commits + tests only.

## Notes for Next Plan

- **Reuse `chatUserProxy(c)`** for the 31-04 file/search/reaction routes — still the single source for the employee-PAT proxy closure; DM channels flow through it identically to regular channels.
- `dm_partner_names` is computed at list time; 31-05 WebSocket should keep it fresh (or recompute) when a new DM arrives.
- The DM section's `has_unreads` dot is the same wired placeholder as channels — populate from real unread counts / the WebSocket in Wave 4/5.
- DM messages already render through the existing channel message list + thread panel (no DM-specific message UI), so reactions/@mentions/files from 31-04 apply to DMs for free.
- Repo layout reminder: live git repo is the nested `internjobs-marketing-website/` (branch `rrr/v1.4/team-workspace-31`); the outer `Internjobs cms` dir is a separate empty repo.
