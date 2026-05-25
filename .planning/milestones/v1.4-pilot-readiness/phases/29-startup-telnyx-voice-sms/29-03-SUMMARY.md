---
schema_version: 1
phase: 29-startup-telnyx-voice-sms
plan: 03
subsystem: startup-mcp-channels
tags: [cloudflare-workers, cron, telnyx, sms, kv, touchbase, hono, tdd]
team: team-cms
milestone: v1.4
status: shipped
completed: 2026-05-25
requires:
  - 29-01  # SMS adapter, intent classifier, sendSms, resolveChannelLink, migration 0014
  - 28-04  # /admin/startups/new endpoint that powers Voice AI register_startup
  - 28-01  # Fly proxy + startup_channel_links UPSERT semantics
provides:
  - "scheduled() Worker export (Monday 14:00 UTC cron)"
  - "Weekly touchbase SMS dispatch with 48h KV cursor"
  - "Numeric-reply fast-path in inbound SMS handler"
  - "Opt-in 'yes' fast-path with /v1/channel-links/:id/opt-in-touchbase"
  - "Extended StartupContext with channel_link_id (additive)"
  - "Live CHANNELS.md sections for telnyx-sms + telnyx-voice"
  - "PILOT-EVIDENCE.md (7-section checklist + sign-off table)"
affects:
  - "v1.5 — per-startup timezone scheduling (currently one global cron)"
  - "v1.5 — admin dashboard for weekly_touchbase opt-in/out toggle"
  - "Future Slack/Discord/Teams adapters reuse the StartupContext.channel_link_id field"
tech-stack:
  added:
    - "Cloudflare Workers cron triggers (wrangler.jsonc triggers.crons)"
    - "Cloudflare KV (TOUCHBASE_CURSORS namespace, declared stub)"
  patterns:
    - "Fast-path interceptors BEFORE intent classifier in webhook handler (numeric + opt-in)"
    - "KV-as-cursor: writer (cron) + reader (webhook) shape contract pinned by parallel unit tests"
    - "Mocked-env unit-test pattern for Worker scheduled handlers (KV stub + fetch stub)"
key-files:
  created:
    - "apps/startup/workers/routes/scheduled.ts (CF Worker scheduled() handler + composeTouchbaseSms + runWeeklyTouchbase)"
    - "apps/startup/workers/routes/scheduled.test.ts (11 unit tests)"
    - ".planning/milestones/v1.4-pilot-readiness/phases/29-startup-telnyx-voice-sms/PILOT-EVIDENCE.md"
  modified:
    - "apps/startup/workers/app.ts (scheduled export wired into default)"
    - "apps/startup/workers/routes/telnyx.ts (numeric + opt-in fast-paths)"
    - "apps/startup/workers/routes/telnyx.test.ts (+14 tests, total 48)"
    - "apps/startup/workers/lib/resolveChannelLink.ts (return channel_link_id)"
    - "apps/startup/workers/types.ts (StartupContext.channel_link_id?)"
    - "apps/startup/wrangler.jsonc (triggers.crons '0 14 * * 1')"
    - "apps/startup/CHANNELS.md (Phase 29 sections → 'live' with code refs)"
    - "infra/startup-api/src/index.mjs (4 new endpoints + channel_link_id added to existing resolve response)"
    - ".planning/milestones/v1.4-pilot-readiness/phases/29-startup-telnyx-voice-sms/PHASE-29-DEFERRED-OPS.md (DEFER-29-03-A..E)"
decisions:
  - "Cron cadence: single global Mon-14:00-UTC schedule for v1.4 (per-startup tz = v1.5)"
  - "KV cursor TTL: 48h — long enough for weekend replies, short enough to avoid stale data"
  - "Numeric fast-path falls THROUGH to intent classifier on KV miss (graceful degradation)"
  - "Opt-in 'yes' fast-path requires channel_link_id; pre-29-03 deploys log-only (intent classifier still hits 'yes' regex)"
  - "fresh-candidates LIMIT 3 hardcoded (founder UX: 'reply 1/2/3' is the contract — adding a 4th breaks SMS-segment math)"
  - "Cursor JSON strips `summary` field — only thread_id + candidate_name + role_title needed for reply lookup (keeps KV value small)"
metrics:
  duration: "~50 minutes (Tasks 1+2+3+tests sequential, all autonomous)"
  commit_count: 4
  test_count_added: 25  # 11 scheduled.test + 14 telnyx.test
  test_count_total: 101  # slug 16 + webhooks 26 + telnyx 48 + scheduled 11
deferred_to_ops:
  - "DEFER-29-03-A: wrangler kv namespace create TOUCHBASE_CURSORS + uncomment binding"
  - "DEFER-29-03-B: migration 0014 apply to Fly Postgres (also DEFER-29-01-K)"
  - "DEFER-29-03-C: wrangler deploy after KV binding (can batch with 29-02 redeploy)"
  - "DEFER-29-03-D: wrangler dev --test-scheduled smoke test"
  - "DEFER-29-03-E: end-to-end pilot run (STARTUP-MULTICHAN-02 evidence capture)"
---

# Phase 29-03 Summary: Weekly Touchbase Cron + Reply Parser + Opt-In

**One-liner:** Monday 14:00-UTC CF Worker cron sends "3 new candidates this week" SMS to opted-in startups with a 48h KV cursor so "reply 1/2/3" maps to the right candidate, plus a "yes" fast-path to re-opt-in after STOP.

Closes the "feel heard, no work" weekly touchpoint that keeps opted-in founders engaged between active hiring cycles. Wave 2 alongside 29-02 (Voice AI). Both Wave-2 plans depend on 29-01 (SMS adapter shipped 2026-05-25) but not on each other — clean parallel ship.

## What Shipped

### 1. CF Worker scheduled() handler (`routes/scheduled.ts`)

`scheduled()` registered as a default-export field on `workers/app.ts`, dispatched on the `0 14 * * 1` cron declared in `wrangler.jsonc`. Body:

1. Guards: `!env.TELNYX_API_KEY` → silent no-op (ops-deferred); `!env.STARTUP_API_URL` → silent no-op.
2. `GET /v1/touchbase/due-startups` — up to 100 startups with `opt_in_flags.weekly_touchbase=true` AND `last_touchbase_at < NOW() - 7d` (or NULL).
3. Per startup:
   - `GET /v1/startups/<id>/fresh-candidates` — up to 3 most recent inbound candidates.
   - `composeTouchbaseSms(founder, startup_name, candidates)` — generates the "hey <name> — N new this week ..." body. 0-candidate variant: "no new candidates this week, but we're actively sourcing".
   - `env.TOUCHBASE_CURSORS.put('touchbase:cursor:<phone>', JSON, {expirationTtl: 172800})` — 48h cursor (skipped if KV unbound or N=0).
   - `sendSms(env, phone, body)`.
   - `PATCH /v1/channel-links/<id>/touchbase-sent` to advance `last_touchbase_at`.
4. Logs `event:"startup_touchbase_cron_complete"` with `processed, dispatched, failed`.

Per-startup try/catch — one bad row does not halt the batch. Function itself never throws (CF cron silently drops thrown exceptions).

### 2. Touchbase fast-paths in `routes/telnyx.ts`

Two interceptors inserted between identity resolution (step 4) and intent classifier (step 5):

- **Numeric reply fast-path** (`/^\s*([1-9])\s*$/`): if KV cursor exists for `from_phone`, look up `cursor[position - 1]`, call `handleExecute('show_candidate', {position, thread_id})`, reply with SMS-formatted candidate. KV miss/expired/out-of-range falls through to the existing 29-01 intent classifier (which still resolves "1" → show_candidate by position alone).
- **Opt-in "yes" fast-path** (`/^\s*(yes|y)\s*$/i`): requires `ctx.channel_link_id` (returned by the extended `/v1/channel-links/resolve`). PATCHes `/v1/channel-links/<id>/opt-in-touchbase` with `{opt_in: true}` and replies "you're in!". Pre-29-03 deploys without `channel_link_id` fall through gracefully.

Both fast-paths write `startup_action_log` audit rows (`touchbase_show_candidate` / `touchbase_opt_in`).

### 3. Fly proxy endpoints (`infra/startup-api/src/index.mjs`)

Four new endpoints (Bearer-gated):
- `GET /v1/touchbase/due-startups` — eligibility query (eligible = opted-in + active + 7d-stale).
- `PATCH /v1/channel-links/:id/touchbase-sent` — advance `last_touchbase_at`.
- `PATCH /v1/channel-links/:id/opt-in-touchbase` — merge `{weekly_touchbase: <opt_in>}` into `opt_in_flags`.
- `GET /v1/startups/:startup_id/fresh-candidates` — top 3 most recent inbound candidates.

Existing `/v1/channel-links/resolve` extended to also return `channel_link_id` in the response (additive — older callers ignore it).

### 4. Schema extension: `StartupContext.channel_link_id?`

Added as optional so `/mcp` Bearer auth (which doesn't go through `resolveChannelLink`) stays unaffected. `resolveChannelLink()` populates it from the extended Fly response.

### 5. CHANNELS.md — Phase 29 sections live

Replaced both Phase 29 SKETCHES with file references:
- **telnyx-sms** section now lists the load-bearing order of `routes/telnyx.ts` (STOP → sig verify → message gate → identity → numeric fast-path → opt-in fast-path → intent → dispatch → format → sendSms).
- **telnyx-voice** section lists the three webhook endpoints in `routes/voice.ts` + the `lib/voice-onboarding.ts` helper + `docs/VOICE_AGENT_CONFIG.md` portal config.

### 6. PILOT-EVIDENCE.md (STARTUP-MULTICHAN-02)

7-section evidence checklist + sign-off table:
1. Voice intake onboarding (STARTUP-VOICE-01..02)
2. SMS opt-in confirmation (STARTUP-TELNYX-04 + STARTUP-TOUCHBASE-01)
3. Weekly touchbase cron (STARTUP-TOUCHBASE-01..02)
4. Numeric reply (STARTUP-TOUCHBASE-02)
5. Natural-language SMS request (STARTUP-TELNYX-03..04)
6. Opt-out / STOP (STARTUP-TELNYX-05)
7. Re-subscribe via START (STARTUP-TELNYX-06)

Each section includes the SQL queries / CLI commands to validate evidence in-place, plus a code block for paste-in of screenshots/output.

### 7. Wrangler config

- `triggers.crons: ["0 14 * * 1"]` added (Mon 14:00 UTC = 9am EST / 10am EDT).
- `TOUCHBASE_CURSORS` KV namespace binding stub remains commented (uncomment after DEFER-29-03-A).

### 8. PHASE-29-DEFERRED-OPS.md

Appended `DEFER-29-03-A..E`:
- A — KV namespace creation
- B — Migration 0014 apply (mirror of 29-01-K, listed here for cron pre-flight)
- C — Worker redeploy after KV bound
- D — `wrangler dev --test-scheduled` smoke test
- E — End-to-end pilot run (PILOT-EVIDENCE.md walkthrough)

## Verification

- `cd apps/startup && npx tsc --noEmit` — zero errors.
- `node --check infra/startup-api/src/index.mjs` — clean.
- `npx tsx --test workers/routes/scheduled.test.ts` — 11/11 pass.
- `npx tsx --test workers/routes/telnyx.test.ts` — 48/48 pass (was 34 from 29-01; +14 for touchbase regexes + cursor shape pin).
- All 7 plan `<verification>` checks pass (cron in wrangler.jsonc, scheduled in app.ts, KV cursor lookup in telnyx.ts, CHANNELS.md (live) × 2, PILOT-EVIDENCE.md present, DEFER-29-03-A..E in deferred-ops file).
- All 14 Phase 29 requirements have task coverage (STARTUP-TELNYX-01..06 in 29-01, STARTUP-VOICE-01..04 in 29-02, STARTUP-TOUCHBASE-01..02 in 29-03, STARTUP-MULTICHAN-01..02 in 29-03).

## Tests Added (25 total)

`workers/routes/scheduled.test.ts` (11):
- composeTouchbaseSms (5): 3 candidates / 1 candidate (singular) / 0 candidates (no-list variant) / null founder / whitespace founder.
- runWeeklyTouchbase end-to-end with mocked env (6): TELNYX_API_KEY unbound silent / empty due-list / happy path with KV+Telnyx+PATCH / 0-candidate (no KV write, SMS+PATCH still fire) / KV unbound (SMS still sent) / cursor JSON shape contract.

`workers/routes/telnyx.test.ts` (+14):
- Numeric fast-path regex (6): '1' / '  3  ' / '9' / '0' (no match) / '10' (no match) / '1 candidate' (no match).
- Opt-in fast-path regex (7): 'yes' / 'YES' / 'y' / '  yes  ' / 'yes please' (no match) / 'no' (no match) / 'yellow' (no match).
- Cursor JSON shape (1): reader expects array, parsed[position-1].thread_id, parsed[8] is undefined when cursor has 3 entries.

Mock pattern (re-usable for future Worker scheduled tests):
- In-memory KV stub recording every `put` + supporting `get`.
- Global-fetch stub routed by URL-substring match, tracking method/body/auth header per call.
- `makeEnv(overrides)` for terse env construction.

## Deviations from Plan

### Auto-fixed

**1. [Rule 3 - Blocking] Extended `/v1/channel-links/resolve` to return `channel_link_id`**

The plan said: "Note: `ctx.channel_link_id` may not be on the current `StartupContext` type from 29-01. If it is not, extend `StartupContext` in `types.ts` to include `channel_link_id?: string` and have `resolveChannelLink` populate it from the `/v1/channel-links/resolve` Fly response."

Verified it WAS missing. Three-step fix:
- Fly `/v1/channel-links/resolve` now SELECTs `cl.id AS channel_link_id` and includes it in the response (additive — older callers like Phase 29-02 voice.ts ignore the new field).
- `lib/resolveChannelLink.ts` extracts `channel_link_id` from response.
- `StartupContext.channel_link_id?: string` added as OPTIONAL — `/mcp` Bearer path still resolves identity via `mcp_token_hash` and doesn't populate this field.

**2. [Rule 2 - Missing Critical] Cursor JSON strips `summary` field before KV write**

The plan said: "Write KV cursor: ... value = JSON array of `{ thread_id, candidate_name, role_title }` for each candidate in order".

Implemented exactly per spec — but the upstream `fresh-candidates` endpoint returns `summary` (the candidate's most recent message) for the SMS body. The cron strips `summary` from the cursor payload (KV value size hygiene). This is a defensive write — the reader (telnyx.ts numeric fast-path) only consumes thread_id + candidate_name + role_title.

### Merge reconciliation

Mid-execution, peer (`executor-29-02`) committed `031f7dd feat(29-02)` which rewrote `apps/startup/workers/app.ts` to add `voiceRouter` mount, accidentally dropping my just-committed `scheduled` import + default-export entry. Resolved with a follow-up commit `2d66192 fix(29-03): re-apply scheduled() export after 29-02 merge` — pure merge reconciliation, no code change.

Both Wave-2 plans share `apps/startup/workers/app.ts` (orchestrator listed it as a non-shared file, but both plans needed to register a new route/export). This is a coordination-protocol learning for v1.5 wave-mode: any plan adding to `app.ts` should declare it as a wave-shared file in the orchestrator config.

## Deviations (files outside frontmatter `files_modified`)

Per HYGN-04, listing every file touched by this plan's commits that wasn't in the frontmatter `files_modified` array — all have authority from the plan body (`<action>` blocks reference them explicitly):

- `apps/startup/workers/app.ts` — scheduled export wire-up (Task 2 `<action>` block explicitly required adapting the default export). Two commits: `4fea3c6` initial, `2d66192` merge-reconcile after peer's `031f7dd`.
- `apps/startup/workers/routes/scheduled.test.ts` — unit tests (plan-level constraint: "Add unit tests for: weekly-cron startup-selection query shape (mock), cursor write/read round-trip (mock KV), reply parser numeric-position resolution, 'yes' re-subscribe handler").
- `apps/startup/workers/routes/telnyx.test.ts` — extended existing test file with 14 new touchbase regex tests (same constraint).
- `apps/startup/workers/lib/resolveChannelLink.ts` — extract `channel_link_id` from Fly response (Task 3 `<action>` block: "have `resolveChannelLink` populate it from the `/v1/channel-links/resolve` Fly response").
- `apps/startup/workers/types.ts` — `StartupContext.channel_link_id?: string` (Task 3 `<action>` block: "extend `StartupContext` in `types.ts` to include `channel_link_id?: string`").
- `infra/startup-api/src/index.mjs` — 4 new endpoints + augmented existing `/v1/channel-links/resolve` response (Task 2 + Task 3 `<action>` blocks both explicitly require Fly proxy changes).
- `.planning/.../29-03-SUMMARY.md` — this file (mandated by `<output>` section).
- `.planning/workstreams/team-cms/STATE.md` — workstream state update (mandated by execute-plan workflow + team-mode constraint).

## Authentication Gates

None — Plan 29-03 ships code only. All Telnyx auth was deferred in 29-01 (DEFER-29-01-E API key, F webhook pubkey, G FROM number).

## Next Phase Readiness

- **For v1.4 release:** Ops backlog DEFER-29-03-A..E must close. Critical path is DEFER-29-03-A (KV namespace) — without that, the cron silently no-ops at runtime even when TELNYX_API_KEY is bound.
- **For v1.5:**
  - Per-startup timezone scheduling (replace global `0 14 * * 1` with per-startup tz preference stored on `startup_channel_links.metadata`).
  - Admin dashboard toggle for `opt_in_flags.weekly_touchbase` (currently founders can only toggle via SMS).
  - `student_threads` table needs first-class `thread_id` (currently cursor uses `student_id` as a stable proxy — works for v1.4 1:1 student-startup but won't scale to multi-role per student per startup).

## Commits (this plan)

- `4fea3c6` `feat(29-03): weekly touchbase cron + Fly proxy endpoints` — scheduled.ts + 4 Fly endpoints + wrangler.jsonc cron + app.ts wire-up + PHASE-29-DEFERRED-OPS appendix.
- `2d66192` `fix(29-03): re-apply scheduled() export after 29-02 merge` — merge reconciliation.
- `01e1e31` `feat(29-03): touchbase fast-paths + channel_link_id + CHANNELS.md live + PILOT-EVIDENCE.md` — Task 3.
- `3a9580d` `test(29-03): 25-case unit suite for cron + touchbase fast-paths` — tests.
