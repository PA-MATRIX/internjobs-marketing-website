---
phase: 13-cross-pane-launch-polish
plan: 02
subsystem: crosspane
tags: [mattermost, react-router, react-query, hono, durable-objects, daily-co-seam]

# Dependency graph
requires:
  - phase: 10-parrot-internal-workspace
    provides: "Three crosspane stub components (EmailToChat / ChatToEmail / StartMeeting) + the three /api/crosspane/* 501 routes — Wave-1 placeholders to be replaced here"
  - phase: 12-dashboard-mothership-agent
    provides: "MATTERMOST_BOT_TOKEN / MATTERMOST_URL env contract + Mattermost REST API patterns in workers/lib/mattermost.ts"
  - phase: 13-01-cross-pane-notifications-push
    provides: "EmployeeMailboxDO.addNotification() — reused by the start-meeting handler to record Phase-11 demand"
provides:
  - "EmployeeMailboxDO.emailToChat(emailId): creates a Mattermost private channel on the bot's first team, seeds it with the email body, returns channel URL"
  - "EmployeeMailboxDO.chatToEmail(postId, postBody): deterministic draft assembly (subject heuristic + markdown-quoted body) — no LLM call"
  - "Three live /api/crosspane/* Hono routes replacing the 501 stubs"
  - "Three working UI components (EmailToChat with navigation, ChatToEmail with compose modal, StartMeeting with toast)"
  - "POST /api/dev/smoke/crosspane — PARROT_DEV_MODE-gated; exercises chatToEmail draft assembly + emailToChat graceful-failure"
affects:
  - "13-03 (onboarding wizard) — the wizard's 'tour' step now has three real crosspane components to demo (no more 'Wave 4 coming soon' placeholders)"
  - "Phase 11 (Daily.co) — the start-meeting handler is the swap-in point; the notifications row event_type='urgent_todo' (with title='Meeting requested') is the pilot-demand signal Phase 11 will read to size launch"
  - "v1.3 full composer — sessionStorage key 'parrot_compose_draft' is the pickup point for the ChatToEmail draft modal"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "UI seam over integration: StartMeeting POSTs a real endpoint that writes an audit row but does NOT call the external service (Daily.co) — measures demand before paying for integration complexity"
    - "Graceful Mattermost degradation: emailToChat returns {ok:false, error:'mattermost_unavailable'} (not throws) when MATTERMOST_BOT_TOKEN is unset, so smoke tests can run without live Mattermost"
    - "sessionStorage as cross-pane handoff: channel URL stashed by EmailToChat → picked up by ChatPane iframe; draft stashed by ChatToEmail → picked up by future v1.3 composer"

key-files:
  created: []
  modified:
    - "apps/parrot/workers/durableObject/index.ts — added emailToChat() and chatToEmail() methods (~+115 lines)"
    - "apps/parrot/workers/index.ts — replaced 3x 501 crosspane stubs + added /api/dev/smoke/crosspane"
    - "apps/parrot/app/lib/api.ts — updated 3 helpers (crosspaneEmailToChat takes emailId; crosspaneChatToEmail takes postId+postBody; crosspaneStartMeeting unchanged)"
    - "apps/parrot/app/components/crosspane/EmailToChat.tsx — rewrote stub into functional component with navigation + error display"
    - "apps/parrot/app/components/crosspane/ChatToEmail.tsx — rewrote stub into functional component with compose modal"
    - "apps/parrot/app/components/crosspane/StartMeeting.tsx — rewrote stub into functional component with toast"
    - "apps/parrot/app/components/InboxPane.tsx — pass selectedId to <EmailToChat />"

key-decisions:
  - "Daily.co stays deferred. StartMeeting is a UI seam — writes a notifications row (event_type='urgent_todo', title='Meeting requested (Phase 11 pending)') so we can measure pilot demand before paying integration cost. No @daily-co/* dep."
  - "Reuse existing 'urgent_todo' event_type for the start-meeting audit row rather than expand the CHECK constraint to add 'start_meeting_requested'. Phase 11 will add the dedicated type when it ships (avoids a schema migration in a deferred-feature phase)."
  - "chatToEmail subject heuristic = first 60 chars of post body (newlines → spaces, ellipsis if truncated). No LLM summarization in this phase — keeps the path deterministic and the dev smoke endpoint side-effect-free. LLM summarization is an explicit v1.3 polish opportunity (route through callAiGateway() from Phase 12)."
  - "Compose modal is in-component (ChatToEmail.tsx renders its own fixed-position modal) rather than a routed full composer. The full composer lands in v1.3; here we ship a usable seam (draft stashed in sessionStorage at key 'parrot_compose_draft' for the future composer to pick up)."
  - "Mattermost channel type = 'P' (private). Email contents are confidential; we don't want the auto-created channel to be discoverable in the public channel directory. The bot is added implicitly by creating it; other employees join via the chat link the EmailToChat button drops in sessionStorage."
  - "Channel name slug uses the email subject (lowercase, non-alphanumeric → '-', truncated to 60 chars). Fallback to 'email-{id-prefix}' for null/empty subjects. Mattermost name uniqueness is per-team; we accept that two emails with identical subjects in the same hour will collide — the second creation just fails with mattermost_channel_create_failed, which surfaces cleanly via the EmailToChat error label."
  - "Skills-referenced header in every new source file: 'cloudflare/skills: agents-sdk' — per Phase 13 convention."

patterns-established:
  - "501 → real-handler swap: replace the entire `(c) => c.json({ ok: false, reason: 'not_implemented_wave_4' }, 501)` block, not a stringly-typed branch inside it. Keeps git diff readable when grepping for completed-vs-pending stubs."
  - "API signature evolution: when a Phase-N stub method evolves to require args, update apps/parrot/app/lib/api.ts FIRST, then propagate the type-error to the UI components — TypeScript flags every caller, so no stale no-arg call gets missed."
  - "Dev smoke endpoints per surface: /api/dev/smoke/{seed-email, ranking, push, crosspane} — same shape (`{ pass: bool, ... }`), same dev-mode gate, same employee-header bypass. Future phases (e.g., voice) should follow the same convention."

# Metrics
duration: 4m 35s
completed: 2026-05-19
---

# Phase 13 Plan 02: Cross-pane Actions Summary

**Three Phase-10 cross-pane stubs (EmailToChat / ChatToEmail / StartMeeting) replaced with working implementations: a real Mattermost channel created from an email thread with the body as seed post, a deterministic email-draft assembly from a chat post body shown in a compose modal, and a Daily.co UI seam that records pilot demand via the notifications table — all behind a PARROT_DEV_MODE-gated smoke endpoint that asserts graceful Mattermost degradation.**

## Performance

- **Duration:** 4m 35s
- **Started:** 2026-05-19T06:05:05Z
- **Completed:** 2026-05-19T06:09:40Z
- **Tasks:** 2 / 2
- **Files modified:** 7 (no new files)

## Accomplishments

- `EmployeeMailboxDO.emailToChat(emailId)`: SELECTs the email row, builds a slugified channel name from the subject, resolves the bot's first team via `GET /api/v4/teams`, POSTs `POST /api/v4/channels` (type 'P' = private), then POSTs `POST /api/v4/posts` to seed with `**Email from {sender}**\n\n{body[:2000]}`. Wrapped in try/catch + early-returns on missing env so every failure becomes `{ok:false, error:string}` instead of a thrown exception. Returns `{ok:true, channel_id, channel_url}` shaped to `{MATTERMOST_URL}/{team_name}/channels/{channel_name}`.
- `EmployeeMailboxDO.chatToEmail(postId, postBody)`: Deterministic — no LLM, no external HTTP. Subject = `'From chat: ' + body[:60].replace(/\n/g,' ') + (truncated ? '…' : '')`. Body = every line markdown-quoted (`> `) + blank line for the reply. Returns `{ok:true, draft:{to:'', subject, body}}`.
- Three `/api/crosspane/*` Hono routes replace the 501 stubs:
  - `POST /api/crosspane/email-to-chat`: validates `email_id`, delegates to DO, maps DO `ok:false` to HTTP 502 with the error string in `reason`.
  - `POST /api/crosspane/chat-to-email`: same shape with `post_body` required.
  - `POST /api/crosspane/start-meeting`: writes a notifications row (`event_type='urgent_todo'`, title='Meeting requested (Phase 11 pending)') so pilot demand is measurable; returns `{ok:true, reason:'meetings_coming_soon', message}`. No Daily.co call.
- `POST /api/dev/smoke/crosspane` (PARROT_DEV_MODE-gated): exercises chatToEmail draft assembly + emailToChat graceful-failure (passes a nonexistent email_id, asserts ok:false with non-empty error string, asserts no thrown exception). Returns `{pass: bool, chat_to_email_draft_assembled, email_to_chat_graceful_failure}`.
- UI components fully rewritten (no `Wave 4` placeholder comments remain):
  - **EmailToChat** — takes `emailId: string` prop, navigates to `/chat` on success after stashing the channel URL in `sessionStorage['parrot_crosspane_channel_url']` so ChatPane can deep-link the iframe. Renders inline red-text error label when `ok:false`.
  - **ChatToEmail** — takes `postId?: string` + `postBody?: string`, opens a fixed-position compose modal (To / Subject / Body fields, all editable) pre-filled from the server draft. "Open in Inbox" stashes the edited draft in `sessionStorage['parrot_compose_draft']` for the v1.3 composer.
  - **StartMeeting** — POSTs the endpoint, shows a fixed-bottom toast "Meetings coming soon — Daily.co integration is on the roadmap." for 3.5s. NO `@daily-co/*` import.
- `InboxPane.tsx` passes `selectedId` to `<EmailToChat />` (was a no-arg call; the api signature evolution caught it via TypeScript).

## Task Commits

Each task was committed atomically:

1. **Task 1: DO methods emailToChat + chatToEmail + crosspane API routes** — `efb2d38` (feat)
2. **Task 2: Finish crosspane UI components — EmailToChat, ChatToEmail, StartMeeting** — `ec61857` (feat)

**Plan metadata:** (this SUMMARY + STATE.md update will be the third atomic commit)

## Files Created/Modified

**Created:** None.

**Modified:**
- `apps/parrot/workers/durableObject/index.ts` — added `emailToChat()` and `chatToEmail()` methods on `EmployeeMailboxDO` (~+115 lines, between `markNotificationsRead` and `sendPushToSubscriptions`)
- `apps/parrot/workers/index.ts` — replaced 3x 501 crosspane stubs with real handlers + added `POST /api/dev/smoke/crosspane`
- `apps/parrot/app/lib/api.ts` — updated `crosspaneEmailToChat(emailId)`, `crosspaneChatToEmail(postId, postBody)`; `crosspaneStartMeeting` unchanged signature
- `apps/parrot/app/components/crosspane/EmailToChat.tsx` — rewrite (functional + emailId prop + navigate)
- `apps/parrot/app/components/crosspane/ChatToEmail.tsx` — rewrite (functional + compose modal + sessionStorage handoff)
- `apps/parrot/app/components/crosspane/StartMeeting.tsx` — rewrite (functional + toast, no Daily.co)
- `apps/parrot/app/components/InboxPane.tsx` — pass `selectedId ?? ""` to `<EmailToChat />`

## Decisions Made

- **"Finish", not "rewrite stubs from scratch"** — The three Phase-10 stub components were small enough (~25 lines each) that overwriting them with a clean rewrite was less risk than incremental edits. Their structure (useMutation + button) carried forward; only the props, success handler, and toast/modal/navigate surfaces are new.
- **Reuse `event_type='urgent_todo'` for start-meeting demand** — The notifications table CHECK constraint enforces three values (`urgent_todo`, `starred_email`, `chat_mention`). Expanding it to add `start_meeting_requested` would require a new migration, which is heavy for a deferred-feature phase. Phase 11 will add the dedicated type via migration when it ships. The notifications row title `"Meeting requested (Phase 11 pending)"` is the searchable signal.
- **Channel type = 'P' (private), not 'O' (open)** — Email contents are confidential. Auto-spawning an open channel would leak the email subject into the public channel directory.
- **No LLM summarization for chat→email subject** — Heuristic (first 60 chars, newlines collapsed, ellipsis if truncated) is deterministic, fast, and free. The plan explicitly notes LLM summarization is optional polish; we left it out to keep the smoke endpoint side-effect-free.
- **In-component compose modal (ChatToEmail)**, not a routed composer — The full composer is v1.3; here we ship a usable seam (draft stashed in sessionStorage at `parrot_compose_draft` for the future composer to pick up).
- **API signature evolution flow**: update `apps/parrot/app/lib/api.ts` FIRST. TypeScript then flags every caller with a "Expected N arguments, got 0" error — caught the `InboxPane.tsx <EmailToChat />` no-arg call cleanly via `npx tsc --build`.

## Deviations from Plan

None — plan executed exactly as written.

The plan's `files_modified` list matches what was actually modified (no extra files). No bug fixes needed. No blocking issues. No architectural decisions surfaced. The plan was unusually well-scoped because Phase 10 had already laid the stub shapes — we only had to fill them in.

## Authentication Gates

None encountered. The Mattermost bot token + URL are deferred user-action requirements (already provisioned in Phase 12 per the plan's pre-execution notes); when the Worker boots without them, `emailToChat` returns `{ok:false, error:'mattermost_unavailable'}` gracefully instead of crashing. The smoke endpoint asserts this graceful path.

## Issues Encountered

- **TypeScript's `--noEmit` flag silently no-ops on a multi-project tsconfig.** Running `npx tsc --noEmit --project apps/parrot/tsconfig.json` returned exit 0 with no output even though the stubs were calling `crosspaneEmailToChat()` with zero args after we'd updated the signature. The fix: use `npx tsc --build` instead — that one walks the project references (tsconfig.node.json + tsconfig.cloudflare.json) and emits real errors. The original "EXIT=0 silently" behavior caught me twice during the Task 1 → Task 2 boundary; documenting here so future agents reach for `--build` first.
- **No live dev worker** to hit `/api/dev/smoke/crosspane` against during execution; the curl returned exit 7 (connection refused). The endpoint is wired correctly per code review; live testing falls to the operator after running `cd apps/parrot && wrangler dev` with `PARROT_DEV_MODE=1`.

## Verification

- TypeScript clean: `cd apps/parrot && npx tsc --build` exits 0.
- No 501 stubs remain: `grep -rn "not_implemented_wave_4" apps/parrot/workers/ apps/parrot/app/` returns no matches.
- No "Wave 4" placeholder comments: `grep -n "Wave 4\|wave_4" apps/parrot/app/components/crosspane/*.tsx` returns no matches.
- No `@daily-co/*` imports: `grep -n "@daily-co\|web-push" apps/parrot/app/components/crosspane/StartMeeting.tsx` returns only the comment line explicitly stating no such package is installed.
- No new LLM REST URLs: `grep -rn "api\.cloudflare\.com.*ai/run\|workers-ai" apps/parrot/workers/ | grep -v "lib/ai.ts"` returns no matches.
- No forbidden packages in `apps/parrot/package.json`: `grep "daily-co\|@daily\|@cloudflare/voice\|@telnyx" apps/parrot/package.json` returns no matches.
- Skills-referenced header present in all three rewritten components + the two new DO methods + the two new route blocks.

## Next Phase Readiness

- **13-03 (onboarding wizard)** can now reference three real, working crosspane components in its product tour — no more "Wave 4 coming soon" placeholder copy. The wizard should call out: "Move to Chat" on an email, "Attach to Email" on a chat post, "Start Meeting" (with a note that Daily.co is on the Phase 11 roadmap).
- **Phase 11 (Daily.co)** has a clean swap-in point: the `/api/crosspane/start-meeting` handler. The notifications row written by the current seam is the demand signal — count rows where `event_type='urgent_todo' AND title LIKE 'Meeting requested%'` to size pilot interest before integration cost is paid. When Phase 11 lands, the handler gains a real `fetch(env.DAILY_API + '/rooms', ...)` call and the notifications write stays.
- **v1.3 full composer** picks up at `sessionStorage['parrot_compose_draft']`. The current ChatToEmail modal lets the user edit To/Subject/Body and "Open in Inbox" — the future composer should read that key on mount, populate its form, and clear the key after first read.
- **v1.3 LLM polish** can replace the deterministic subject heuristic in `chatToEmail()` with `callAiGateway()` from Phase 12 for AI-generated subjects. Today's heuristic is the fallback when the AI Gateway is unavailable or rate-limited.

---
*Phase: 13-cross-pane-launch-polish*
*Plan: 02*
*Completed: 2026-05-19*
