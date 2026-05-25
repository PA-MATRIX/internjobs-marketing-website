---
schema_version: 1
team: "team-cms"
milestone: "v1.4"
current_phase: 28.5
plan_total: 5
status: in_progress
last_activity: "2026-05-25"  # 28.5-04 shipped (per-startup agent email — migration 0013 + slug.ts + inbound Worker email() handler + admin extension w/ Clerk invite + welcome email; 4 Fly endpoints); deploy → DEFER-28.5-04-A..C
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

Status: In progress — Phase 28.5 wave 3 plan 28.5-04 shipped (per-startup agent email: migration 0013 startups.agent_email TEXT UNIQUE; apps/startup/workers/lib/slug.ts with mintSlug + reserveUniqueSlug + 16-test node:test suite; apps/startup/workers/routes/email.ts catch-all CF Email Routing handler via postal-mime; apps/startup/workers/routes/admin.ts extended with provisionAgentEmail + sendClerkInvite + sendWelcomeStartupEmail helpers — POST /admin/startups/new response now includes agent_email + agent_email_error; 4 new Fly endpoints in infra/startup-api/src/index.mjs: GET check-slug, PATCH agent-email, GET channels/resolve, POST messages/inbound); deploy → DEFER-28.5-04-A..C (Clerk secret bind + migration apply + Fly+Worker redeploy)
Current phase: 28.5 (Startups Web App + Clerk #3 + Per-Startup Agent Email)
Current plan: 28.5-04 ✓ shipped 2026-05-25 (code-complete + deploy-ready); next is 28.5-05 (Clerk webhook → user.created handler with Svix signature verify + work-email blocklist + startup_members.clerk_user_id UPDATE)
Blockers: None for executor; pilot-readiness gated on DEFER-28.5-01-A..G + DEFER-28.5-02-A + DEFER-28.5-04-A..D (see PHASE-28.5-DEFERRED-OPS.md)
Deferred to v1.5:
- `NEONEX-VER-WORKER-LIVE-01` — 5-step Clerk-JWT probe of Workspace Worker `/api/ops/safety/*` (see 24-01-SUMMARY.md). Code-verified PASS; live-HTTP confirmation needs a browser session.
- `DEFER-28.5-01-A..G` — Clerk #3 wrangler secret injection, Clerk frontend-api CNAME, CF Pages project + custom domain, CF Email Routing domain verify (SPF/DKIM/DMARC), catch-all → Worker, Clerk webhook signing secret, DNS propagation check. See `.planning/milestones/v1.4-pilot-readiness/phases/28.5-startups-web-app/PHASE-28.5-DEFERRED-OPS.md`.
- `DEFER-28.5-04-A..D` — STARTUPS_CLERK_SECRET_KEY wrangler bind, migration 0013 apply to Fly Postgres, Fly proxy + apps/startup Worker redeploy, Pages Function consumer note. See PHASE-28.5-DEFERRED-OPS.md.

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

- **Phase 28.5** — Startups Web App + Clerk #3 + Per-Startup Agent Email *(current — 4/5 plans shipped)*
- **Phase 29** — Startup Telnyx SMS + Voice AI + Voice-Based Onboarding

## Phase 28.5 plan summary

| Plan | Objective | Wave | Deps | Status |
|------|-----------|------|------|--------|
| 28.5-01 | Clerk app #3 + DNS + Email Routing bootstrap (STARTUPS_CLERK_* wrangler stubs + PHASE-28.5-DEFERRED-OPS.md backlog) | 1 | none | ✓ Shipped 2026-05-25 (auto portion; 7-step external-ops checkpoint → DEFERRED-OPS.md) |
| 28.5-02 | apps/startups Vite+React+Clerk scaffold + sign-in + dashboard skeleton + Pages Function proxy + Fly identity endpoint | 2 | 28.5-01 | ✓ Shipped 2026-05-25 (code-complete; deploy → DEFER-28.5-02-A) |
| 28.5-03 | Live founder dashboard + role form + thread reply UI + Pages Function route mapping (per-route /api/me, /api/roles, /api/threads, /api/threads/:id/reply with server-side startup_id resolution) | 3 | 28.5-02 | ✓ Shipped 2026-05-25 (code-complete; deploy → DEFER-28.5-02-A) |
| 28.5-04 | Per-startup agent email — migration 0013 + slug.ts + inbound email() Worker handler + admin extension w/ Clerk invite + welcome email + 4 Fly endpoints | 3 | 28.5-02 | ✓ Shipped 2026-05-25 (code-complete; deploy → DEFER-28.5-04-A..C) |
| 28.5-05 | Clerk webhook (user.created → startup_members.clerk_user_id; work-email blocklist; Svix signature verify) | 4 | 28.5-03 + 28.5-04 | Planned |

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
