---
phase: 12-dashboard-mothership-agent
plan: 02
subsystem: agent
tags: [cloudflare, ai-gateway, durable-objects, do-alarm, mattermost, kimi-k2, workers-ai, sqlite, hono]

# Dependency graph
requires:
  - phase: 12-01
    provides: "todos table on EmployeeMailboxDO, callAiGateway + extractTodosFromText helpers in workers/lib/ai.ts, GET /api/dashboard/todos route, getTodos() DO stub, Env extensions (CLOUDFLARE_AI_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, PARROT_AI_GATEWAY_ID, KIMI_MODEL, MATTERMOST_BOT_TOKEN, PARROT_DEV_MODE)"
provides:
  - "EmployeeMailboxDO.extractTodosFromEmail() — fire-and-forget LLM extraction triggered inside createEmail() for Inbox folder, routes through AI Gateway with cf-aig-cache-ttl=3600"
  - "EmployeeMailboxDO.alarm() + initAlarm() + pollMattermostNewPosts() — 2-minute self-rescheduling DO alarm that polls Mattermost via bot-token REST and extracts todos via AI Gateway with cf-aig-cache-ttl=1800"
  - "EmployeeMailboxDO.extractTodosFromChat() — wraps extractTodosFromText with chat-source bookkeeping; 429 audit logging"
  - "EmployeeMailboxDO.getTodos(view) — hybrid-rank SQL query: urgency_score×2 + mention(+30) + deadline-24h(+40) + deadline-1h(+20) - recency_decay(hours/6); supports view = all|mentions|today|week"
  - "EmployeeMailboxDO.insertTodos() — INSERT OR IGNORE on source_id dedup helper"
  - "EmployeeMailboxDO.debugInsertTodo() — PARROT_DEV_MODE-gated RPC for Plan 12-03 deterministic regression tests"
  - "EmployeeMailboxDO.cleanupTodosForEmail() — marks todos resolved when source email is deleted (called from deleteEmail)"
  - "workers/lib/mattermost.ts — resolveMmUserId / getMmChannelsForUser / getMmPostsSince + MM_USER_ID_NONE sentinel; since=ms-5000 guards against mattermost#13846 race"
  - "POST /api/dev/smoke/seed-email — PARROT_DEV_MODE-gated smoke endpoint that seeds an urgent email and asserts at least one email-sourced todo is extracted"
  - "AI Gateway 429 path: writes audit_events.event_type='ai_gateway_quota_exceeded' (best-effort, table is future migration) + returns [] without crashing source ingest"
affects: [12-03, "v1.3 telephony", "v1.3 audit_events migration"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DO alarm self-reschedule in finally block — guarantees the 2-min polling cycle survives Mattermost outages"
    - "Fire-and-forget extraction (void this.extractTodosFromEmail) inside createEmail — LLM never blocks email storage"
    - "since=ms-5000 overlap window + INSERT OR IGNORE on source_id — defends against mattermost#13846 missed-post race"
    - "MM_USER_ID_NONE sentinel cached in DO storage — handles employee that hasn't logged into Mattermost yet without per-alarm fetch storms"
    - "Differentiated cf-aig-cache-ttl: 3600 for email (idempotent across multi-recipient delivery), 1800 for chat (refresh faster)"
    - "PARROT_DEV_MODE-gated RPC methods + smoke endpoint pattern for deterministic regression testing in later waves"

key-files:
  created:
    - "apps/parrot/workers/lib/mattermost.ts"
  modified:
    - "apps/parrot/workers/durableObject/index.ts"
    - "apps/parrot/workers/index.ts"

key-decisions:
  - "Audit log on 429 wrapped in try/catch — audit_events table is a future migration; quota-exceeded logging is best-effort so a missing table never crashes the extractor."
  - "MM_USER_ID_NONE sentinel kept across alarm cycles + re-resolved on every tick (not just first miss) — so an employee that logs into Mattermost later auto-onboards without operator intervention."
  - "Smoke endpoint uses setTimeout(500ms) to give fire-and-forget extraction a window to complete — valid only inside wrangler dev (Node-compat layer); endpoint is hard-gated by PARROT_DEV_MODE so production is unaffected."
  - "Chat extraction uses the first post's id as source_id (rather than per-post extraction) — keeps the LLM call count down (one call per 2-min batch per channel) and matches the cf-aig-metadata.user_id quota model."
  - "Recency decay is integer division (hours_since / 6) so the rank is monotonic over time without floating-point noise in SQLite."

patterns-established:
  - "AI Gateway is the SINGLE LLM transport for Parrot — no direct Workers AI REST anywhere. Verified by grep: only `gateway.ai.cloudflare.com` appears in LLM-touching code."
  - "Email storage path is decoupled from LLM extraction via void prefix — extraction failure can never produce a 5xx on the user-facing inbox flow."
  - "DO alarm is at-least-once via setAlarm in finally — Mattermost 5xx / network blips do NOT kill the polling cycle."
  - "Watermark (last_mm_poll_at) advances ONLY on successful poll loop completion — partial failures re-fetch the same window on next tick (idempotent via INSERT OR IGNORE)."

# Metrics
duration: 3m 5s
completed: 2026-05-19
---

# Phase 12 Plan 2: Dashboard Mothership Agent Ingest + Extraction Summary

**Email + Mattermost ingest wired through Cloudflare AI Gateway with per-employee quota metadata: createEmail() fire-and-forgets todo extraction for Inbox messages, a 2-minute self-rescheduling DO alarm polls Mattermost via bot-token REST with since=ms-5000 overlap, and getTodos() ranks via hybrid SQL formula with recency decay.**

## Performance

- **Duration:** 3m 5s
- **Started:** 2026-05-19T05:13:58Z
- **Completed:** 2026-05-19T05:17:03Z
- **Tasks:** 2
- **Files modified:** 3 (2 modified + 1 created)
- **Commits:** 2 atomic task commits

## Accomplishments

- **Email ingest is live.** `createEmail()` calls `void this.extractTodosFromEmail(email, profile.employeeId)` whenever the destination folder is `Inbox`. Email storage is non-blocking (fire-and-forget); extraction errors are logged but never propagate to the inbox writer. AI Gateway transport uses `cf-aig-cache-ttl=3600` since the same email body is idempotent across multi-recipient delivery (cc/bcc cache hits).
- **Mattermost alarm is wired.** `upsertProfile()` registers an initial 2-minute alarm via `void this.initAlarm()`. The `alarm()` handler always reschedules in a `finally` block — so a Mattermost 5xx or network blip can never kill the polling cycle. `pollMattermostNewPosts()` resolves the employee's MM user_id (cached, with `MM_USER_ID_NONE` sentinel for "not logged in yet"), lists their channels, fetches posts since the last successful poll watermark minus 5000ms (guards against mattermost#13846), and dispatches to `extractTodosFromChat()` with `cf-aig-cache-ttl=1800`.
- **Hybrid-rank getTodos() shipped.** SQL formula: `urgency_score×2 + (is_mention ? 30 : 0) + (deadline_within_24h ? 40 : 0) + (deadline_within_1h ? 20 : 0) - floor(hours_since_created / 6)`. View filter supports `all | mentions | today | week`. Returns top 50 unresolved todos ordered by computed rank.
- **debugInsertTodo RPC available.** Gated by `PARROT_DEV_MODE=1`. Lets Plan 12-03 regression tests insert deterministic todos (bypass LLM) for ranking-formula assertions.
- **Smoke endpoint live.** `POST /api/dev/smoke/seed-email` seeds a synthetic urgent email (Action required: please review the contract by Friday EOD), waits 500ms for fire-and-forget extraction, then asserts `getTodos('all')` returns at least one row matching `source_channel='email'`. Returns `{ pass: true/false, todos_extracted: N, todos: [...] }`. Hard-gated by `PARROT_DEV_MODE` so production is unaffected.
- **429 quota path documented + tested via grep.** Both `extractTodosFromEmail()` and `extractTodosFromChat()` log an `audit_events` row with `event_type='ai_gateway_quota_exceeded'` when `extractTodosFromText` returns `null` (the 429 sentinel from `callAiGateway`). The audit INSERT is wrapped in try/catch because the `audit_events` table is a future migration — best-effort by design.
- **Zero new npm packages.** Verified by lack of any `npm install` or package.json edit.
- **TypeScript compiles clean.** `npx tsc --noEmit` in `apps/parrot` returns zero errors across both task commits.

## Task Commits

1. **Task 1: Mattermost helpers + email/chat extraction hooks + DO alarm** — `611ba42` (feat)
2. **Task 2: dev-only smoke endpoint POST /api/dev/smoke/seed-email** — `b502609` (feat)

## Files Created/Modified

**Created:**
- `apps/parrot/workers/lib/mattermost.ts` — 4 exports (`MattermostPost` interface, `MM_USER_ID_NONE` sentinel, `resolveMmUserId()`, `getMmChannelsForUser()`, `getMmPostsSince()`). Inline comments document the mattermost#13846 race, the bot-account system-admin auth requirement, and the user-id resolution-failure retry pattern. Skills referenced comment block names `cloudflare/skills: cloudflare`.

**Modified:**
- `apps/parrot/workers/durableObject/index.ts` — Added 9 new methods on `EmployeeMailboxDO`: `insertTodos` (private), `getTodos` (replaces Wave 1 stub with real ranking SQL), `debugInsertTodo` (PARROT_DEV_MODE-gated RPC), `cleanupTodosForEmail` (private), `extractTodosFromEmail` (private, fire-and-forget caller), `initAlarm`, `alarm` (self-rescheduling), `pollMattermostNewPosts` (private), `extractTodosFromChat` (private). Modified existing methods: `createEmail` (added `void this.extractTodosFromEmail(...)` after attachments insert when `folderId === Folders.INBOX`), `upsertProfile` (added `void this.initAlarm()` before the return), `deleteEmail` (added `this.cleanupTodosForEmail(id)` before the delete). Added top-of-file imports for `extractTodosFromText` and the four Mattermost exports.
- `apps/parrot/workers/index.ts` — Appended the `POST /api/dev/smoke/seed-email` Hono route before the `export { app }` line.

## Decisions Made

- **AI Gateway-only transport** — No direct Workers AI REST anywhere in Parrot. The only LLM-related URL in the Worker codebase is `gateway.ai.cloudflare.com/v1/.../workers-ai/...` in `workers/lib/ai.ts` (the helper from Wave 1). Confirmed via `grep -rn` audit during verification.
- **`audit_events` table is best-effort** — The plan body explicitly calls out that `audit_events` is a future migration. Both extractor 429-handlers wrap the INSERT in try/catch so a missing table never crashes the extraction path. When the migration eventually lands, the existing INSERT statements will start succeeding without code changes.
- **Re-resolve `MM_USER_ID_NONE` on every alarm tick** — Initially the sentinel is set when the employee has no MM account yet (e.g., first login to Parrot before their first Mattermost SSO). On every subsequent alarm we re-call `resolveMmUserId`, so the moment they DO log into Mattermost their alarm auto-onboards without operator intervention.
- **Cache TTL split (3600 email / 1800 chat)** — Same email body sent to multiple recipients (cc/bcc) re-routes through the same DO with the same body — high cache value. Chat posts can be quoted/forwarded but their text refreshes more often (edits, retro-context), so a tighter TTL is correct.
- **First-post id as chat batch source_id** — Mattermost polling batches multiple posts per LLM call to keep cost down. Using `posts[0].id` as the dedup key means re-polls of the same window (after a 5-second overlap or after the alarm restarts) re-insert against the same source_id and INSERT OR IGNORE drops the duplicates cleanly.

## Deviations from Plan

None - plan executed exactly as written.

The plan's `files_modified` frontmatter listed `apps/parrot/workers/types.ts`, but inspection confirmed `PARROT_AI_GATEWAY_ID` and `PARROT_DEV_MODE` were already declared in `Env` by Plan 12-01 (both in the `CfEnvBase` `Omit` tuple and as explicit fields with appropriate optionality). Task 2's action text explicitly anticipated this case ("If they are already there from Wave 1, do not duplicate them"), so leaving types.ts untouched is in-spec, not a deviation. No additional files touched outside the plan's declared scope.

## Issues Encountered

None. TypeScript compiled clean on the first pass after each task commit. All verification greps passed on the first run.

## User Setup Required

**External service: Cloudflare AI Gateway provisioning (carryover from Wave 1).** Wave 2 code is now in place and uses the AI Gateway helper from Wave 1. To make live LLM calls in production, the user still needs to (from Wave 1's USER-SETUP):

1. Log in to `dash.cloudflare.com` → Account → AI → AI Gateway → Create.
2. Name the gateway `internjobs-parrot` (slug becomes `PARROT_AI_GATEWAY_ID`).
3. Configure per-user daily limit: 200 requests/day/employee.
4. Run `wrangler secret put PARROT_AI_GATEWAY_ID` + `wrangler secret put CLOUDFLARE_AI_API_TOKEN` + `wrangler secret put CLOUDFLARE_ACCOUNT_ID` (`0fffd3dc637bdb26d4963df445a69fd3` from Infisical) on the `internjobs-parrot` Worker.

**Additionally, for Mattermost polling to function in production:**

5. Create a Mattermost bot account in System Console → Integrations → Bot Accounts. Grant System Admin role so it can read private channels and DMs.
6. Copy the bot's personal access token; `wrangler secret put MATTERMOST_BOT_TOKEN` on the `internjobs-parrot` Worker.

If these are unset, the code fail-soft:
- `callAiGateway()` returns `null` on missing AI credentials → `extractTodosFromText()` returns `[]` → no todos extracted, no crash.
- `pollMattermostNewPosts()` returns immediately when `MATTERMOST_BOT_TOKEN` is missing → alarm reschedules cleanly.

Local dev with `PARROT_DEV_MODE=1` can hit `POST /api/dev/smoke/seed-email` to validate the email path end-to-end once the AI Gateway secrets are in `.dev.vars`.

## Next Phase Readiness

**Ready for Wave 3 (12-03 — Ranking polish + click-through):**
- `getTodos(view)` already returns ranked rows in the documented hybrid formula. Wave 3 can layer UI affordances (group-by, click-to-source, resolve, snooze) on top without DO-side changes.
- `debugInsertTodo` is exposed as an RPC method on the DO — Wave 3's deterministic regression tests can call `stub.debugInsertTodo(employeeId, {...})` to insert rows with known urgency_scores and assert ranking math.
- The smoke endpoint `POST /api/dev/smoke/seed-email` is in place as the seed for Wave 3's end-to-end test harness.

**Blockers/concerns:**
- Audit-events log INSERTs are silently dropped today (no table). When the `audit_events` migration lands (likely as part of Phase 13 or a hygiene plan), the existing log sites will start succeeding without code changes — but the gap means the `ai_gateway_quota_exceeded` events are not visible in production logs until that migration lands. Mitigation: the same condition also `console.warn`s from `callAiGateway` so a 429 is visible in Cloudflare tail logs in the meantime.
- `getMmChannelsForUser` enumerates ALL channels the bot can see and filters by team membership — this is N+1 (one fetch per team) but acceptable for v1.2 (small team count per employee). If the user count grows large, switching to `/api/v4/users/{user_id}/channels_members` is the right v1.3 move.
- The 5-second overlap (`since=ms-5000`) re-fetches posts that were already extracted on the previous tick. `INSERT OR IGNORE` on `(source_channel, source_id)` drops the duplicates cheaply — but the LLM call still happens, costing one AI Gateway request per overlap. v1.3 optimization: track post IDs already seen in DO storage and skip the LLM call if every post in the window is a known duplicate.

---

*Phase: 12-dashboard-mothership-agent*
*Plan: 02*
*Completed: 2026-05-19*
