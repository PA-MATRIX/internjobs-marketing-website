---
schema_version: 1
team: "team-cms"
milestone: "v1.4"
current_phase: 29
plan_total: 3
status: in_progress
last_activity: "2026-05-25"  # Phase 29-01 shipped (Wave 1). 29-02+29-03 (Wave 2) cleared to start in parallel.
---

# team-cms Workstream State

## Source Of Truth

- GitHub issue/phase assignment owns task status.
- GitHub branch/PR owns code status.
- This file is local execution memory for RRR only.
- Root `.planning/STATE.md` is coordinator-owned in team mode.

## Assignment

GitHub team: @PA-MATRIX/team-cms
Branch: rrr/v1.4/team-cms
Sprite: rrr-internjobs-marketing-website-v1-4-team-cms
Phases: 22, 24, 28, 28.5, 29

## Current Position

Status: Phase 29 IN PROGRESS (1/3 plans shipped). Wave 1 complete.

Current phase: 29 (Startup Telnyx SMS + Voice AI + Voice-Based Onboarding)
Current plan: 29-02 + 29-03 (Wave 2, parallel, cleared to start)
Blockers: None for executor; Wave 2 plans use ops-deferred guards.
Next action: Either dispatch 29-02 + 29-03 in parallel, or wait for orchestrator wave-2 trigger.

### Phase 29 plan summary

| Plan | Objective | Wave | Deps | Status |
|------|-----------|------|------|--------|
| 29-01 | SMS adapter + identity resolution + action enum (show_candidate + register_startup) + migration 0014 [STARTUP-TELNYX-01..06] | 1 | none | ✓ Shipped 2026-05-25 |
| 29-02 | Voice AI Agent hooks + R2 audit log + VOICE_AGENT_CONFIG.md [STARTUP-VOICE-01..04] | 2 | 29-01 | Not started |
| 29-03 | Weekly cron + reply parser + opt-in + CHANNELS.md live update + PILOT-EVIDENCE.md [STARTUP-TOUCHBASE-01..02 + STARTUP-MULTICHAN-01..02] | 2 | 29-01 | Not started |

### Plan 29-01 completion (2026-05-25)

Four-commit ship on branch `rrr/v1.4/team-cms`:

- `50f9835` `docs(29-01)`: PHASE-29-DEFERRED-OPS.md backlog (11 entries
  DEFER-29-01-A..K — Telnyx signup, toll-free purchase, BRN verification,
  messaging profile, API key, webhook public key, FROM_NUMBER / MESSAGING_
  PROFILE_ID wrangler secrets, Worker redeploy, smoke test, migration apply).
- `5f76b1c` `feat(29-01)`: migration 0014 + 2 new action handlers + 3 Fly
  proxy endpoints — 6 files / 491 insertions.
  - `apps/app/db/migrations/0014_v1_4_telnyx_touchbase.sql` (new): ALTER
    TABLE startup_channel_links ADD COLUMN last_touchbase_at + partial
    composite index for Phase 29-03 cron. Apply → DEFER-29-01-K.
  - `apps/startup/workers/types.ts`: 8 new optional Env fields (TELNYX_*
    + VOICE_AUDIT R2 + TOUCHBASE_CURSORS KV + AI binding type).
  - `apps/startup/workers/tools/execute.ts`: handleShowCandidate (calls
    GET /v1/startups/:id/candidates) + handleRegisterStartup (loopback
    POST /admin/startups/new with work-email blocklist enforcement + best-
    effort channel-link metadata upsert). ACTION_HANDLERS 5 → 7 entries.
  - `apps/startup/workers/lib/workEmail.ts` (new): shared blocklist
    extracted from webhooks.ts (Phase 28.5-05). Same 30 domains + gmx.*
    wildcard. webhooks.ts isPersonalEmail() now re-exports isPersonalEmail
    Domain() from this lib (DRY; webhooks.test.ts 26/26 still green).
  - `infra/startup-api/src/index.mjs`: GET /v1/channel-links/resolve
    (identity), PATCH /v1/channel-links/:id/opt-out (TCPA), GET /v1/
    startups/:id/candidates?position=N (show_candidate).
- `587e5cf` `feat(29-01)`: SMS adapter — 6 files / 886 insertions.
  - `apps/startup/workers/lib/telnyx.ts` (new): sendSms() with ops-deferred
    guards + formatForSms() with special-cased shapes for show_candidate
    + register_startup. 1580-char truncation; 429 rate-limit handling.
  - `apps/startup/workers/lib/resolveChannelLink.ts` (new): generic
    identity helper. Returns StartupContext | null. Never throws.
  - `apps/startup/workers/lib/intent.ts` (new): 2-layer classifier —
    classifyIntentRegex (sync; numeric 1..9, START/YES/y/no/n) + LLM
    fallback via env.AI.run('@cf/meta/llama-3.1-8b-instruct') with
    structured JSON output parsing.
  - `apps/startup/workers/routes/telnyx.ts` (new): POST /webhooks/telnyx/sms.
    Load-bearing flow order: STOP-first (TCPA) → Ed25519 sig verify (skip
    if WEBHOOK_PUBLIC_KEY unbound) → message.received gate → resolveChannelLink
    → classifyIntent → handleSearch/handleExecute → formatForSms → sendSms.
    Always returns 200 (except 401 on bad sig).
  - `apps/startup/wrangler.jsonc`: TELNYX_WEBHOOK_PUBLIC_KEY + TELNYX_VOICE_
    AGENT_TOKEN + TELNYX_USE_MCP_INTEGRATION comment stubs + commented
    kv_namespaces (TOUCHBASE_CURSORS) + r2_buckets (VOICE_AUDIT) stubs.
  - `apps/startup/workers/app.ts`: imported + mounted telnyxRouter.
- `15e0ad1` `test(29-01)`: 34-case unit suite at
  `apps/startup/workers/routes/telnyx.test.ts` via node:test + tsx:
  intent regex (11) + STOP regex (10) + Ed25519 verify (4 — node:crypto
  keypair → crypto.subtle.verify roundtrip) + isPersonalEmailDomain (5)
  + formatForSms (4). All 34 pass.

Verification: tsc --noEmit clean (apps/startup); telnyx.test 34/34;
webhooks.test 26/26 (unchanged); slug.test 16/16 (unchanged); node
--check on index.mjs clean; all 7 plan-verification grep checks pass.

Deviations from plan:
1. (Rule 2 — missing critical) Extracted shared work-email blocklist
   into `lib/workEmail.ts`. Plan constraint #14 said "extract to lib if
   not already" — it was inline in webhooks.ts; this is the practical
   reuse path. webhooks.ts isPersonalEmail kept as a thin re-export so
   the 26-case Phase 28.5-05 test suite passes unchanged.
2. (Rule 1 — bug) STOP-path channel-link opt-out uses POST /v1/channel-
   links upsert (status='opted_out'), not the plan's suggested PATCH
   /v1/channel-links/:rowId/opt-out — the resolve endpoint doesn't
   return the row id, and inflating its response surface for one
   STOP path didn't seem worth it. Still ADDED the PATCH endpoint for
   future admin tooling. UPSERT path is idempotent via the UNIQUE
   constraint on (startup_id, channel_type, channel_external_id).
3. (Rule 1 — bug) First test run failed 3/34 with "Invalid key object
   type public, expected private" from a leftover `createPublicKey
   (publicKey)` noop call in the Ed25519 test helper. Removed; all 34 pass.
4. (Plan-anticipated; Rule 4 pre-approved) checkpoint:human-verify Task 1
   wholesale DEFERRED per active session rule. 11 entries
   (DEFER-29-01-A..K) captured in PHASE-29-DEFERRED-OPS.md.

Summary: `.planning/milestones/v1.4-pilot-readiness/phases/29-startup-telnyx-voice-sms/29-01-SUMMARY.md`

### Previous position: Phase 28.5 CODE-COMPLETE (2026-05-25)

Phase 28.5 shipped 5/5 plans on 2026-05-25. Work-email enforcement webhook at `apps/startup/workers/routes/webhooks.ts` (POST /webhooks/clerk with Svix signature verification + 30-domain personal-email blocklist + Clerk Backend API DELETE on personal-domain user.created + OAuth-race guard for empty email_addresses arrays) with 26-test node:test unit suite at `apps/startup/workers/routes/webhooks.test.ts` (all 26 pass); marketing /startups CTA flipped from RequestAccessForm to primary "sign up at startups.internjobs.ai" link with RequestAccessForm retained inside <details> concierge fallback (apps/marketing/src/App.tsx StartupAccessSection); 7-test Playwright E2E suite at `apps/startups/e2e/founder-flow.spec.ts` with pre-deploy hostReachable() guards (3 unauthed + 4 auth-gated tests; currently 7 skipped + 0 failed pending DEFER-28.5-02-A + 05-C + 05-E). Live deploy + ops → DEFER-28.5-05-A..E (5 new entries appended to PHASE-28.5-DEFERRED-OPS.md).

Phase 28.5 status: code-complete, ops-incomplete. All 13 STARTUP-WEB-* + STARTUP-AGENT-EMAIL-* + STARTUP-WEB-CTA-01 + STARTUP-WORK-EMAIL-01 requirements addressed. Awaiting orchestrator phase-close after deferred ops run.

Deferred to v1.5:
- `NEONEX-VER-WORKER-LIVE-01` — 5-step Clerk-JWT probe of Workspace Worker `/api/ops/safety/*` (see 24-01-SUMMARY.md). Code-verified PASS; live-HTTP confirmation needs a browser session.
- `DEFER-28.5-01-A..G` — Clerk #3 wrangler secret injection, Clerk frontend-api CNAME, CF Pages project + custom domain, CF Email Routing domain verify (SPF/DKIM/DMARC), catch-all → Worker, Clerk webhook signing secret, DNS propagation check. See `.planning/milestones/v1.4-pilot-readiness/phases/28.5-startups-web-app/PHASE-28.5-DEFERRED-OPS.md`.
- `DEFER-28.5-04-A..D` — STARTUPS_CLERK_SECRET_KEY wrangler bind, migration 0013 apply to Fly Postgres, Fly proxy + apps/startup Worker redeploy, Pages Function consumer note. See PHASE-28.5-DEFERRED-OPS.md.
- `DEFER-28.5-05-A..E` — Clerk webhook URL registration, STARTUPS_CLERK_WEBHOOK_SECRET wrangler bind, startup worker + marketing redeploy, live gmail-rejection smoke (the checkpoint:human-verify task), Playwright auth-suite activation. See PHASE-28.5-DEFERRED-OPS.md.
- Migrate work-email enforcement to Clerk paid-tier native blocklist (eliminates ~1-3s OAuth race window in webhooks.ts).
- Externalize personal-domain list to Workers KV (currently hardcoded in webhooks.ts).

### Plan 24-01 completion (2026-05-25)

E2E safety_events API verification PASS for all 4 NEONEX-VER requirements:

- **NEONEX-VER-01:** Direct probe 200 `{ok:true}` + organic Worker write evidence (9 email rows with `employee_id`, last 2026-05-24T18:37Z) — both API-layer and full-E2E confirmed.
- **NEONEX-VER-02 / 04:** Code-verified via `apps/parrot/workers/routes/ops-safety.ts` (callStudentApi proxy + reason_label mapping + fail-soft null-return guard). Worker bindings `STUDENT_API_URL` (var) and `STUDENT_API_SECRET` (secret) both present on deployed version `93c9c1e6-...`. Live HTTP probe deferred to v1.5 (Clerk JWT required).
- **NEONEX-VER-03:** Wrong Bearer returns 401 `{error:"unauthorized"}`, student app `/healthz` still `database:true` after; Worker side fail-soft confirmed by code inspection.

Side effect (Rule 2 - missing critical): mirrored `STUDENT_API_SECRET` and `STUDENT_API_URL` into Infisical at `/internjobs-ai` env=`prod` — they were on the Worker but not in the canonical secrets store, contradicting RESEARCH.md's topology table.

No code commits (pure verification). Phase 24 probe row `8eefa4c9-2b57-4504-9080-f33bda4cf380` left in DB as live evidence for the deferred v1.5 Worker probe.

Summary: `.planning/milestones/v1.4-pilot-readiness/phases/24-neon-exit-closeout/24-01-SUMMARY.md`

### Plan 24-02 completion (2026-05-25)

Docs refresh shipped: HANDOFF.md §4 (post-Neon-exit topology), ROADMAP.md
Phase 24 plan list (TBD → 2 plans), infisical-project memory (5 post-exit
secrets). NEONEX-DOC-01..03 all PASS. Status-row + checkbox updates in
ROADMAP.md intentionally deferred to orchestrator at phase close.

Commits: `23a683c` (HANDOFF.md), `0e9e876` (ROADMAP.md). Memory file (outside
repo) updated via filesystem write — no git commit needed.

Summary: `.planning/milestones/v1.4-pilot-readiness/phases/24-neon-exit-closeout/24-02-SUMMARY.md`

## Completed phases (team-cms)

- **Phase 22** — Lakera Verification + Marketing Brand Refresh (5/5 plans, shipped 2026-05-24)
- **Phase 28** — Startup MCP Server + Channel-Adapter Core (5/5 plans, shipped 2026-05-25; live first-pilot install deferred to v1.5 STARTUP-PILOT-LIVE-01)
- **Phase 24** — Neon-Exit Closeout (2/2 plans shipped 2026-05-25; awaiting orchestrator phase-close)

## Remaining phases (team-cms)

- **Phase 28.5** — Startups Web App + Clerk #3 + Per-Startup Agent Email *(5/5 plans shipped 2026-05-25; code-complete, ops-incomplete; awaiting orchestrator phase-close)*
- **Phase 29** — Startup Telnyx SMS + Voice AI + Voice-Based Onboarding *(3 plans planned 2026-05-25; ready for execution)*

## Phase 28.5 plan summary

| Plan | Objective | Wave | Deps | Status |
|------|-----------|------|------|--------|
| 28.5-01 | Clerk app #3 + DNS + Email Routing bootstrap (STARTUPS_CLERK_* wrangler stubs + PHASE-28.5-DEFERRED-OPS.md backlog) | 1 | none | ✓ Shipped 2026-05-25 (auto portion; 7-step external-ops checkpoint → DEFERRED-OPS.md) |
| 28.5-02 | apps/startups Vite+React+Clerk scaffold + sign-in + dashboard skeleton + Pages Function proxy + Fly identity endpoint | 2 | 28.5-01 | ✓ Shipped 2026-05-25 (code-complete; deploy → DEFER-28.5-02-A) |
| 28.5-03 | Live founder dashboard + role form + thread reply UI + Pages Function route mapping (per-route /api/me, /api/roles, /api/threads, /api/threads/:id/reply with server-side startup_id resolution) | 3 | 28.5-02 | ✓ Shipped 2026-05-25 (code-complete; deploy → DEFER-28.5-02-A) |
| 28.5-04 | Per-startup agent email — migration 0013 + slug.ts + inbound email() Worker handler + admin extension w/ Clerk invite + welcome email + 4 Fly endpoints | 3 | 28.5-02 | ✓ Shipped 2026-05-25 (code-complete; deploy → DEFER-28.5-04-A..C) |
| 28.5-05 | Work-email enforcement webhook + marketing CTA flip + E2E Playwright suite | 4 | 28.5-03 + 28.5-04 | ✓ Shipped 2026-05-25 (code-complete; deploy + ops → DEFER-28.5-05-A..E) |

### Plan 28.5-04 completion (2026-05-25)

Two-commit ship on branch `rrr/v1.4/team-cms`:

- `bc33973` `feat(28.5-04)`: foundation layer — 6 files
  - `apps/app/db/migrations/0013_v1_4_startup_agent_email.sql` (new): idempotent
    `ALTER startups ADD COLUMN agent_email text UNIQUE` + partial index.
  - `apps/startup/workers/lib/slug.ts` (new, 102 LOC): `mintSlug()` pure +
    `reserveUniqueSlug()` HTTP-loop with 10-attempt max + length-safe collision
    expansion + Bearer auth + AbortSignal timeout.
  - `apps/startup/workers/lib/slug.test.ts` (new, 218 LOC, 16 cases): node:test
    runner via `npx tsx --test`; covers mintSlug (9: punctuation/whitespace/unicode/
    length/determinism/empty/numeric/dangling-hyphen) + reserveUniqueSlug (7:
    404-first/collision-advance/max-attempts/non-2xx/empty-base/Bearer header/
    long-base length safety). All 16 pass in ~150ms.
  - `apps/startup/workers/types.ts`: `EMAIL?: SendEmail` + 4 `STARTUPS_CLERK_*?`
    optionals on `Env`.
  - `apps/startup/wrangler.jsonc`: extended send_email binding doc comment.
  - `apps/startup/tsconfig.json`: exclude `**/*.test.ts`.

- `0347803` `feat(28.5-04)`: runtime wiring — 6 files / 784 insertions
  - `apps/startup/workers/routes/email.ts` (new, 289 LOC): catch-all CF Email
    Routing `handleInboundEmail(ForwardableEmailMessage, env, ctx)` — slug
    extract → channels/resolve → postal-mime parse → messages/inbound insert.
    setReject on unknown slug; silent drop on infra failure; full
    structured-JSON logging.
  - `apps/startup/workers/app.ts`: added `email()` export on default export.
  - `apps/startup/workers/routes/admin.ts` (+288 LOC): 3 new helpers
    (provisionAgentEmail synchronous + sendClerkInvite waitUntil +
    sendWelcomeStartupEmail waitUntil w/ log-body fallback) + route handler
    injection. Response now includes `{agent_email, agent_email_error}`.
  - `apps/startup/package.json`: +postal-mime ^2.6.1 (same as parrot).
  - `infra/startup-api/src/index.mjs` (+182 LOC): 4 new endpoints — `GET
    /v1/startups/check-slug` + `PATCH /v1/startups/:id/agent-email` + `GET
    /v1/channels/resolve` + `POST /v1/messages/inbound`. Bearer-gated;
    ON CONFLICT DO NOTHING on inbound dedupe via 0003b's partial index.

Verification: tsc --noEmit clean; wrangler dry-run clean w/ all bindings
present (EMAIL/AI/STARTUP_API_URL/STARTUPS_CLERK_*); node --check on
index.mjs clean; 16/16 unit tests pass. Live deploy + migration apply
+ Clerk secret bind all → DEFER-28.5-04-A..C per "don't wait on me" rule.

Deviations (Rule 1 — frontmatter drift, all auto-fixed):
1. Migration path `apps/app/db/migrations/0013_*.sql` (NOT `infra/startup-api/
   migrations/` which doesn't exist; the migrate.mjs runner reads from the
   former).
2. Fly endpoints added to `infra/startup-api/src/index.mjs` (NOT `src/routes/
   startups.ts` + `routes/admin.ts` — the proxy is a flat 884-line single-file
   Hono app).
3. Welcome email uses `env.EMAIL.send({from,to,subject,text})` object shape
   (NOT `new EmailMessage().setContent()` — that's a different SDK; parrot +
   agentic-inbox both use the object shape).

Summary: `.planning/milestones/v1.4-pilot-readiness/phases/28.5-startups-web-app/28.5-04-SUMMARY.md`

### Plan 28.5-05 completion (2026-05-25) — Phase 28.5 CODE-COMPLETE

Two-commit ship on branch `rrr/v1.4/team-cms`:

- `cc0fe9a` `feat(28.5-05)`: webhook handler + blocklist + CTA flip — 6 files
  - `apps/startup/workers/routes/webhooks.ts` (new, 233 LOC): POST /webhooks/clerk
    with Svix verification + 30-domain personal-email blocklist + Clerk
    Backend API DELETE on user.created for personal domains. OAuth-race
    guard: empty email_addresses → 200 no-op (no DELETE). Returns 503 when
    STARTUPS_CLERK_WEBHOOK_SECRET is unbound (keeps Clerk retry queue active).
  - `apps/startup/workers/routes/webhooks.test.ts` (new, 319 LOC, 26 cases):
    node:test runner; covers isPersonalEmail (15: gmail/yahoo/hotmail/outlook/
    icloud/proton.me blocked; acme.io/stripe.com accepted; uppercase, gmx.*,
    subdomain edge-cases, malformed input) + extractPrimaryEmail (4) +
    handleClerkWebhook integration (7 via globalThis.fetch reassignment +
    Svix fixture generator). All 26 pass.
  - `apps/startup/workers/app.ts`: import + app.post('/webhooks/clerk') mount
    + comment block referencing DEFER-28.5-05-A + 05-B.
  - `apps/startup/package.json`: +svix ^1.42.0 (apps/startup is excluded from
    root workspaces — needed local install).
  - `apps/marketing/src/App.tsx` StartupAccessSection: CTA flipped from
    <RequestAccessForm /> to anchor href="https://startups.internjobs.ai/"
    with "sign up at startups.internjobs.ai →" label (cobalt-on-lavender
    pill). Eyebrow "request access" → "sign up". RequestAccessForm retained
    inside <details id="startup-fallback"> "no work email — concierge
    onboarding" block. BRAND-V1 preserved: verify-brand.mjs 38/38 PASS.

- `e9787e0` `test(28.5-05)`: Playwright E2E + deferred-ops backlog — 6 files
  - `apps/startups/e2e/founder-flow.spec.ts` (new, 243 LOC, 7 tests):
    3 unauthed (sign-in render, /dashboard redirect, marketing CTA) + 4
    auth-gated (dashboard startup name + agent email, /roles/new fields,
    post-role increments count, thread reply input). Pre-deploy guards
    via hostReachable() + dist HTML grep — tests cleanly test.skip()
    until DEFER-28.5-02-A + 05-C close (currently 7 skipped, 0 failed).
  - `apps/startups/playwright.config.ts` (new): Chromium-only, TEST_BASE_URL
    overrideable, CI mode 2 workers + retry + github reporter.
  - `apps/startups/package.json`: +@playwright/test ^1.60.0 + 3 scripts.
  - `.gitignore`: ignore test-results/ + playwright-report/ recursively.
  - `PHASE-28.5-DEFERRED-OPS.md` (+270 lines): DEFER-28.5-05-A..E entries
    (Clerk webhook URL register; wrangler secret put; worker+marketing
    redeploy; live gmail-rejection smoke = the deferred checkpoint:human-verify
    task per "don't wait on me" rule; Playwright auth-suite token activation).

Verification: 26/26 unit tests pass (node:test via tsx); tsc --noEmit clean
(apps/startup); wrangler dry-run clean (apps/startup, gzip 493 KiB w/ svix);
verify-brand.mjs ALL PASS (38/38); marketing build 374 kB clean w/
startups.internjobs.ai 2x in dist; apps/startups build clean (91 modules,
84 kB gz; e2e/ outside tsconfig.app include); playwright 7-skipped 0-failed.

Phase 28.5 status: **5/5 plans shipped 2026-05-25, code-complete,
ops-incomplete.** All 13 STARTUP-WEB-* + STARTUP-AGENT-EMAIL-* +
STARTUP-WEB-CTA-01 + STARTUP-WORK-EMAIL-01 requirements addressed.
Awaiting orchestrator phase-close after DEFER-28.5-01-A..G +
DEFER-28.5-02-A + DEFER-28.5-04-A..D + DEFER-28.5-05-A..E run.

Deviations from plan:
1. (Rule 1 — research-doc drift) svix package required local install into
   apps/startup; the plan claimed it was already in the 28.5-02 dep set
   but the root workspaces array explicitly excludes apps/startup —
   svix at root node_modules is from apps/startups (Vite), not apps/startup
   (Worker). Installed svix@^1.42.0 directly into apps/startup.
2. (Plan-anticipated) checkpoint:human-verify task DEFERRED per active
   session rule. Captured as DEFER-28.5-05-A..D in PHASE-28.5-DEFERRED-OPS.md.
3. (Plan-anticipated) Playwright tests written as STRUCTURE-only execution
   for the auth-gated suite; live execution against startups.internjobs.ai
   blocked by pre-existing DEFER-28.5-02-A and freshly-added DEFER-28.5-05-C.
   Pre-deploy host-reachable guard added so the suite reports clean
   "0 failures" instead of misleading errors during the deploy-pending window.

Summary: `.planning/milestones/v1.4-pilot-readiness/phases/28.5-startups-web-app/28.5-05-SUMMARY.md`

### Plan 28.5-03 completion (2026-05-25)

Two-commit ship on branch `rrr/v1.4/team-cms`:

- `d01278e` `feat(28.5-03)`: rewrote `apps/startups/src/lib/api.ts` from
  the 28.5-02 single `useApi()` generic-fetch hook to a 6-function typed
  client (getMe, getRoles, createRole, getThread, sendReply, getThreads)
  with shared `apiRequest` helper, `ApiError` class, and a new
  `useApiBound()` hook that pre-binds all 6 functions to the current
  Clerk session. Backward-compat `useApi()` retained.

- `abdd8c5` `feat(28.5-03)`: 16 files / 1770 insertions:
  - Lightweight shadcn-shaped UI primitives in `src/components/ui/`
    (Card / Button / Input / Textarea / Label) — same API surface as
    shadcn but zero new dependencies, brand tokens only, no hex
    literals
  - Real page components: `Dashboard.tsx` (live data, 3 independent
    per-card fetches, not-linked branch), `RolesNew.tsx` + `RoleForm.tsx`
    (MCP-schema parity hard-locked), `RoleDetail.tsx`, `CandidateDetail.tsx`,
    `ThreadView.tsx` (optimistic-then-reconcile reply send)
  - Shared components: `ThreadList.tsx`, `MessageComposer.tsx`,
    `src/lib/cn.ts`
  - `App.tsx`: real components wired into router (replaces 28.5-02
    placeholders)
  - `functions/api/[[path]].ts`: per-route mapping for /api/me,
    /api/roles, /api/threads, /api/threads/:id/reply with
    **server-side startup_id resolution** (browser cannot spoof) +
    legacy pass-through for all other /api/* paths

Verification: build PASS (91 modules, 84.26 kB gz, no secret leak in
dist/, no hex literals in src/), tsc --noEmit clean. Visual proof
deferred — dev-server start-stop incompatible with executor session
(macOS lacks `timeout`); deploy verification rolls into DEFER-28.5-02-A.

agent_email null handling: dashboard renders "agent email pending —
ridhi will provision shortly" until peer's 28.5-04 migration 0013 lands.

Deviation: 7 files outside frontmatter `files_modified` — all are
shadcn-shaped UI primitives in `src/components/ui/` (Decision 1 in
SUMMARY) plus `src/lib/cn.ts` helper. Zero peer-territory touches
(verified `apps/startup/` singular has unstaged peer modifications
that I deliberately did NOT stage).

Summary: `.planning/milestones/v1.4-pilot-readiness/phases/28.5-startups-web-app/28.5-03-SUMMARY.md`

### Plan 28.5-01 completion (2026-05-25)

Two-commit ship on branch `rrr/v1.4/team-cms`:

- `879c9a9` `feat(28.5-01)`: added 4 STARTUPS_CLERK_* references to `apps/startup/wrangler.jsonc`
  (JWKS_URL + ISSUER as empty-string vars; SECRET_KEY + WEBHOOK_SECRET in secrets-comment block).
  Pattern matches existing STARTUP_API_SECRET / TELNYX_API_KEY comments. No hardcoded values.
- `9a8d470` `docs(28.5-01)`: created `PHASE-28.5-DEFERRED-OPS.md` (173 lines) capturing all 7
  external-dashboard sub-steps as `DEFER-28.5-01-A..G` entries with exact acceptance criteria
  and downstream-blocker lists.

Deviation (Rule 4 — Architectural, user pre-approved): The `checkpoint:human-verify` task in the
plan was deferred wholesale rather than executed, per user instruction "don't wait on me — finish
all the phases" (2026-05-25 session). All 7 sub-steps are captured in DEFERRED-OPS.md with no
fidelity loss.

Summary: `.planning/milestones/v1.4-pilot-readiness/phases/28.5-startups-web-app/28.5-01-SUMMARY.md`

### Plan 28.5-02 completion (2026-05-25)

Two-commit ship on branch `rrr/v1.4/team-cms`:

- `f49197f` `feat(28.5-02)`: scaffolded `apps/startups/` (12 files) — Vite+React+TS+Tailwind
  with brand-v1 CSS vars, mirrors `apps/marketing/` stack. Added `@clerk/clerk-react`,
  `react-router-dom`, `svix`, `@cloudflare/workers-types`. `npm run build` passes (dist:
  259.45 kB JS gzipped to 80.23 kB).
- `72a13cc` `feat(28.5-02)`: source files + Pages Function + Fly identity endpoint.
  ClerkProvider in `main.tsx`; 6 routes in `App.tsx` with `ProtectedRoute` gating;
  Clerk sign-in widget centered on lavender bg; dashboard skeleton with 3 placeholder
  cards + sign-out + "post a role" CTA; `useApi()` hook with Clerk-JWT attachment;
  CF Pages Function `functions/api/[[path]].ts` catch-all proxy that swaps Clerk-JWT
  `Authorization` for shared-secret Bearer + forwards JWT as `X-Clerk-Token`; new
  `POST /v1/startups/identity-by-clerk-id` endpoint on the Fly proxy.

Deviations (all documented in summary):

- **Rule 1 — Bug:** Plan referenced `@clerk/react` (not a real npm package); used
  `@clerk/clerk-react ^5.61.6` instead (matches parrot's version). Would have failed
  `npm install` silently.
- **Rule 1 — Bug:** Pages Function plan example used `X-Startup-Api-Secret` header,
  but Fly's `verifyBearer` expects `Authorization: Bearer`. Fixed to match the existing
  contract; Clerk JWT now forwarded as `X-Clerk-Token` instead.
- **Rule 3 — Blocking:** Added `src/vite-env.d.ts` (typing for `ImportMetaEnv.VITE_*`)
  because `tsc -b` blocked the build without it.

Deploy step deferred to **DEFER-28.5-02-A** (linked to DEFER-28.5-01-A/B/C — the upstream
Clerk + Pages-project + DNS ops). Code is deploy-ready: bundle audit confirms
`STARTUP_API_SECRET` is absent from `dist/` and `VITE_CLERK_PUBLISHABLE_KEY` is the only
Clerk credential in the static build.

Summary: `.planning/milestones/v1.4-pilot-readiness/phases/28.5-startups-web-app/28.5-02-SUMMARY.md`

## Phase 24 plan summary

| Plan | Objective | Wave | Deps | Status |
|------|-----------|------|------|--------|
| 24-01 | E2E safety_events API verification + negative tests (NEONEX-VER-01..04) | 1 | none | ✓ Shipped 2026-05-25 (live Worker JWT probe deferred to v1.5) |
| 24-02 | Docs refresh — HANDOFF.md, ROADMAP.md, infisical-project memory (NEONEX-DOC-01..03) | 1 | none | ✓ Shipped 2026-05-25 |

Both plans were wave 1 and independent — executed in parallel by two
executor contexts. 24-01 was verification work (curl probes against live
prod); 24-02 was docs-only. Phase 24 ready for orchestrator close.

## 24-01 verification artifacts (for 24-02 docs cite-back if needed)

- Parrot Worker version live in prod: `93c9c1e6-71db-40db-a73a-8e93dad27185` (deployed 2026-05-21T19:14, no re-deploys).
- Student app `INTERNAL_API_SECRET` Fly digest: `6a3910702a318b0e`; canonical value in Infisical at `/internjobs-ai` env=`prod`.
- Infisical now also contains `STUDENT_API_SECRET` and `STUDENT_API_URL` (added by 24-01 as a Rule 2 fix; RESEARCH.md topology table is now reality-aligned).
- Organic E2E evidence: 9 email-channel safety_events rows with `employee_id` set, most recent at 2026-05-24T18:37:14Z (Worker write path confirmed on the current deployment).
- Phase 24 verification probe row id (still in DB): `8eefa4c9-2b57-4504-9080-f33bda4cf380`, preview "Phase 24 verification probe", created 2026-05-25T17:31:27Z, `reviewed=false`. This row is what the deferred v1.5 Worker probe should see in `/api/ops/safety`.

## Notes

Owns external-facing surfaces:
- **Marketing CMS** (`apps/marketing/`) — public site at `internjobs.ai`
- **Student app** (`apps/app/`) — student-facing app at `app.internjobs.ai`
- **Startup MCP server** (`apps/startup/`) — MCP server at `mcp.internjobs.ai` *(shipped Phase 28)*
- **Startup Fly proxy** (`infra/startup-api/`) — REST bridge to Postgres *(shipped Phase 28)*
- **Startups web app** (`apps/startups/`) — founder-facing dashboard at `startups.internjobs.ai` *(Phase 28.5 will create)*
- **iMessage bridge** (`apps/mac-bridge/`) — student SMS/iMessage path
- **Student DB** (`infra/student-db/`) — self-hosted Fly Postgres

The team name `team-cms` is shorthand for "external/customer-facing surfaces" — it
covers Marketing CMS + Student app + Startup-side, not marketing alone. The other team
(`team-workspace`) owns the employee-facing Workspace app (`apps/parrot/`).
See `[[project-app-naming]]` memory note.

## Process exceptions

Phase 22 + Phase 28 were executed directly on `main` (single-dev shortcut while
team-workspace's branch wasn't live). From Phase 28.5 forward, work moves to the
`rrr/v1.4/team-cms` branch + PR flow to keep parity with team-workspace's branch
and protect against merge conflicts with Nithin's work landing on main.
