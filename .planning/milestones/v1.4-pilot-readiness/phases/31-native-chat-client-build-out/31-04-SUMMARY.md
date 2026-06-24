---
phase: 31-native-chat-client-build-out
plan: "04"
subsystem: chat
tags: [mattermost, files, search, reactions, mentions, streaming-upload, cloudflare-workers, react, react-query]

# Dependency graph
requires:
  - phase: 31-01
    provides: per-employee MM PAT (WorkspaceDO 3_mm_tokens) + mmFetchAsUser (401 re-mint) + resolveEmployeeToken
  - phase: 31-02
    provides: chatUserProxy(c) employee-PAT proxy helper + ChatPane secondaryNav channel browser + /api/chat/posts (PAT-authored)
  - phase: 31-03
    provides: DM/group channels as first-class message surfaces + /api/chat/team-members roster + relaxed post/read membership gates
provides:
  - Worker streaming file route — POST /api/chat/files (c.req.raw.body pass-through, no buffering) + GET /api/chat/files/:id (Content-Type forwarded for inline image render)
  - Worker GET search + reaction routes — POST /api/chat/search, POST + DELETE /api/chat/reactions (all as employee PAT via chatUserProxy)
  - mattermost.ts helpers — searchMmPosts, addMmReaction, removeMmReaction, getMmPostReactions
  - /api/chat/posts now accepts optional file_ids and allows attachment-only (empty-text) posts
  - ChatPane rich content — file attach + drag-drop, inline image preview, global search overlay, emoji reaction picker + chips, @mention autocomplete + highlighting
affects:
  - 31-05 WebSocket real-time (reactions + new file/search posts become WS-driven; reaction counts should refresh live instead of 5s poll)
  - 31-06 hardening/UAT (file upload, search, reactions are the live visual-verify surface; requires MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true on Fly)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "File upload streams via c.req.raw.body (ReadableStream) with duplex:'half' straight to MM /api/v4/files — NEVER c.req.formData() (would buffer the whole upload in Worker memory and OOM against the 128MB limit)"
    - "Inline image preview proxy: GET /api/chat/files/:id forwards the UPSTREAM Content-Type (image/*) instead of defaulting to application/octet-stream, so <img src> renders inline rather than forcing a download"
    - "Multipart upload from the client uses the raw apiFetch (NOT chatFetch, which forces application/json) + native FormData so the browser sets the multipart boundary automatically; file_ids are then attached to the JSON POST /api/chat/posts"
    - "Search + reactions proxy AS the employee via chatUserProxy/mmFetchAsUser inline (Wave-0 401 re-mint preserved); the new mattermost.ts helpers are exported + unit-tested but routes call the proxy directly — same posture as 31-02/31-03"
    - "@mention parsing is pure client-side: /\\B@(\\w*)$/ at the caret opens the autocomplete; /\\B@(\\w+)/g wraps mentions in styled spans (sky for others, yellow bg for self)"

key-files:
  created:
    - apps/parrot/workers/routes/chat-files.ts
    - apps/parrot/workers/tests/lib/mattermost-search-reactions.test.ts
  modified:
    - apps/parrot/workers/lib/mattermost.ts
    - apps/parrot/workers/index.ts
    - apps/parrot/app/components/ChatPane.tsx

key-decisions:
  - "File upload route streams c.req.raw.body with duplex:'half' (no formData buffering) per 31-RESEARCH; @ts-expect-error covers duplex missing from lib.dom RequestInit. The GET proxy forwards upstream Content-Type + Content-Disposition so images render inline."
  - "Search + reaction routes call chatUserProxy(c).call(...) inline rather than the new searchMmPosts/addMmReaction/removeMmReaction helpers, to keep the employee-PAT 401 re-mint path; the helpers are still exported (must_haves exports contract) and covered by 10 unit tests."
  - "POST /api/chat/posts extended to accept optional file_ids and accept attachment-only posts (message OR >=1 file_id) — required so the plan's 'file_ids included in subsequent POST /api/chat/posts' flow works for image-only messages."
  - "Reaction toggle is refetch-based (invalidate the channel posts query) rather than optimistic — MM embeds reactions on the post object, so a refetch is the simplest correct source of truth for this wave; matches the plan's 'show reactions only if already on post.reactions' guidance (no per-post reaction fetch on load)."
  - "Emoji glyph<->MM short-name mapping is a hardcoded 20-entry table (EMOJI_PICKER) with a reverse Map (EMOJI_GLYPH) so existing reaction chips render the glyph; unknown names fall back to :name:."

patterns-established:
  - "Search mode swaps the message list + composer for a SearchPanel inside the same chat content section (not the disabled WorkspaceShell header input); result click jumps via selectChannel + closeSearch; Esc closes."
  - "Pending uploads tracked as local state with per-file status (uploading/error) + object-URL image previews, revoked on send/remove to avoid leaks; send is blocked while any file is still uploading."
  - "No new npm packages — emoji picker, drag-drop, mention parse/highlight all use native browser APIs + Tailwind, per plan constraint."

# Metrics
duration: 12min
completed: 2026-06-19
---

# Phase 31 Plan 04: Rich Content + Search Summary

**The Chat tab is now feature-complete for real team use: employees can attach files and images (streamed through the Worker with zero buffering so large uploads don't OOM), see images render inline, search every message across all their channels and DMs from a debounced global search overlay, react with a 20-emoji quick-picker (toggle add/remove), and @mention teammates with live autocomplete + highlighting — all authored AS the real Mattermost user via the Wave-0 PAT.**

## Performance

- **Duration:** ~12 min
- **Tasks:** 2 of 2
- **Files modified:** 3 (+2 created: 1 route, 1 test)

## Accomplishments

- **New `workers/routes/chat-files.ts`** (`chatFilesRoute`, mounted at `/api/chat/files`):
  - `POST /` — streams the multipart body via `c.req.raw.body` + `duplex:"half"` directly to MM `POST /api/v4/files?channel_id=…` using the employee PAT. **No `c.req.formData()`** (would buffer the whole upload). Forwards the inbound `Content-Type` (carries the boundary). Returns the MM `file_infos` payload.
  - `GET /:fileId` — proxies the file download for inline preview, **forwarding the upstream `Content-Type`** (e.g. `image/png`) + `Content-Disposition` so `<img src="/api/chat/files/:id">` renders inline instead of forcing a download; `Cache-Control: private, max-age=3600`. 503 `chat_not_provisioned` when the employee has no PAT.
- **4 new `mattermost.ts` helpers** — `searchMmPosts` (POST /api/v4/teams/{id}/posts/search), `addMmReaction` (POST /api/v4/reactions), `removeMmReaction` (DELETE …/reactions/{emoji}), `getMmPostReactions` (GET …/reactions) — with **10 unit tests** (method/path/body shape, is_or_search flag, null-body handling, success/failure mapping).
- **3 new Worker routes** in `index.ts`, all `requireEmployeeMailbox` + employee-PAT via `chatUserProxy`:
  - `POST /api/chat/search` — body `{ terms, team_id? }` (team_id falls back to the bootstrap team); returns the MM search post list.
  - `POST /api/chat/reactions` — body `{ post_id, emoji_name }`; adds the reaction as the employee.
  - `DELETE /api/chat/reactions` — same body; removes the reaction.
  - Plus `POST /api/chat/posts` extended to accept optional `file_ids` and allow attachment-only posts.
- **ChatPane** gained all four rich-content features (no new deps):
  - **Files:** paperclip attach button + textarea drag-and-drop; multipart upload via raw `apiFetch`; pending-file chips with image thumbnails + upload spinner + remove; `file_ids` attached on send; inline `<img>` / file-download rendering for received posts (`metadata.files` or `file_ids`).
  - **Search:** header search toggle → full `SearchPanel` overlay (debounced 400ms) → `/api/chat/search`; results show channel label + author + time + snippet with mention highlighting; click jumps to channel; Esc/X closes.
  - **Reactions:** `Smile` button in the hover action row opens a 20-emoji grid picker; reaction chips below messages with counts + mine-highlight; click toggles add/remove via `/api/chat/reactions`.
  - **@mentions:** caret-aware autocomplete dropdown above the composer (filters cached `/api/chat/team-members`); selecting inserts `@username `; mentions highlighted in message + search text (sky for others, yellow bg when it's the signed-in employee).

## Task Commits

1. **Task 1: file upload streaming proxy + search/reactions Worker routes** — `b7c7d8b` (feat)
2. **Task 2: ChatPane file attach, search, reactions, @mention autocomplete** — `6af3cd2` (feat)

**Plan metadata:** `<this commit>` (docs: complete plan)

## Files Created/Modified

- `apps/parrot/workers/routes/chat-files.ts` *(created, 94 lines)* — streaming upload + inline-preview download proxy.
- `apps/parrot/workers/tests/lib/mattermost-search-reactions.test.ts` *(created)* — 10 unit tests for the 4 new helpers.
- `apps/parrot/workers/lib/mattermost.ts` — added `searchMmPosts`, `addMmReaction`, `removeMmReaction`, `getMmPostReactions` + `MattermostReaction` interface (all take a bearer token directly).
- `apps/parrot/workers/index.ts` — import + mount `chatFilesRoute`; new `/api/chat/search` + `/api/chat/reactions` (POST + DELETE) routes; `POST /api/chat/posts` now accepts `file_ids` + attachment-only posts.
- `apps/parrot/app/components/ChatPane.tsx` *(2179 lines)* — file attach/drag-drop/preview, `SearchPanel`, reaction picker + chips, @mention autocomplete + `renderMessageText`/`EMOJI_PICKER`/`postFiles`/`groupReactions` helpers, extended `MmPost` (file_ids/metadata/reactions).

## Verification

- `npx tsc -b` in apps/parrot: **zero errors** (run after Task 1 and Task 2).
- `npx react-router build`: **succeeds** (client + SSR bundles; `chat-BfPIh9mN.js` 45.93 kB, gzip 11.76 kB — up from 33.56 kB in Wave 2, reflecting the four new features).
- `npx vitest run`: **47 tests pass across 10 files** (10 new search/reaction-helper tests + 37 existing, zero regressions).
- `npm run typecheck` (package script) was run; its `cf-typegen` + `react-router typegen` steps complete and the meaningful compile gate (`tsc -b`) is clean. The real `react-router build` was also run directly and is clean.
- Browser `chrome_visual_check` / Playwright from `verification.surface: ui_affecting` were NOT executed in this sandbox — no live MM instance with `MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true`, no browser/Clerk prod session. The successful build (full component tree compiles) + the helper unit tests are the substitute. Live visual verification (upload a PNG → inline render, `curl -I /api/chat/files/:id` → `Content-Type: image/*`, search/reaction/@mention walkthrough) is deferred to plan 31-06 UAT — consistent with the phase's deploy gate.

## Deviations from Plan

### Helpers exported but search/reaction routes proxy inline (design choice, not a gap)
Same posture as 31-02/31-03: the new `searchMmPosts`/`addMmReaction`/`removeMmReaction` helpers take a **raw token** and would bypass the Wave-0 401 re-mint. So the routes call `chatUserProxy(c).call(...)` inline to stay self-healing, while the helpers are still **exported** (must_haves `exports` contract) and covered by 10 unit tests. Both goals met. `getMmPostReactions` is exported + tested but not wired into a route this wave (the plan says don't make per-post reaction API calls on load — reactions render from `post.reactions` when MM embeds them); it's available for 31-05 if a live reaction refresh is added.

### POST /api/chat/posts extended for file_ids + attachment-only posts (Rule 2 — missing critical)
The plan's key_links require `file_ids` to be "included in subsequent POST /api/chat/posts", but that route only read `{ channel_id, message }` and required non-empty `message`. Extended it to (a) forward optional `file_ids` to MM and (b) accept a post with message OR ≥1 file_id (image-only messages). Without this the file-attach flow couldn't actually send. This is the one backend change that logically belongs to Task 2's UI wiring; it was committed in the Task 2 commit (`6af3cd2`) alongside ChatPane since both files form one coherent attach-flow change.

### `<img>` wrapped in a target=_blank link (minor UX add)
Inline images are wrapped in an `<a target="_blank">` to the same proxy URL so a click opens the full-size image — a small affordance beyond the plan's bare `<img>` spec, using the same Content-Type-forwarding GET route. No new surface.

## Authentication Gates

None. No CLI/API auth prompts were hit (no deploy, no live MM calls — code + build + vitest only).

## Production Gate / Deferred

- All file/search/reaction operations depend on the employee PAT, which requires `MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true` on the internjobs-mattermost Fly app — **deferred to plan 31-06 Task 1**. Until then the routes return `503 chat_not_provisioned` and ChatPane shows the friendly reason copy.
- No production deploy / `wrangler deploy` was performed (per critical-environment note + the `CLOUDFLARE_ACCOUNT_ID` no-op gotcha). Code + commits + tests only.

## Notes for Next Plan

- **31-05 (WebSocket):** reactions currently refresh on the 5s post poll + on toggle-invalidate — switch to WS events for live reaction/file-arrival updates; `getMmPostReactions` (already exported) is the helper if a targeted per-post refresh is needed.
- Search results render through `renderMessageText` (mention highlight) but are read-only snippets — 31-05/06 could deep-link to the exact post (scroll-to + flash) rather than just selecting the channel.
- File upload is streamed but unbounded client-side — 31-06 hardening should add a client size/type guard + surface MM's max-file-size error nicely (the route already passes MM's status through).
- DMs inherit all four features for free (they flow through the same message list / posts routes), per the 31-03 note.
- Repo layout reminder: live git repo is the nested `internjobs-marketing-website/` (branch `rrr/v1.4/team-workspace-31`); the outer `Internjobs cms` dir is a separate empty repo.
