---
schema_version: 1
team: "team-cms"
milestone: "v1.4"
current_phase: 28.5
plan_total: 5
status: in_progress
last_activity: "2026-05-25"  # 28.5-03 shipped (live dashboard + role form + thread reply UI + Pages Function route mapping); deploy → DEFER-28.5-02-A
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

Status: In progress — Phase 28.5 wave 3 plan 28.5-03 shipped (live founder dashboard wired to /api/me + /api/roles + /api/threads, role creation form with MCP-schema parity, candidate-thread view + optimistic reply send, lightweight shadcn-shaped UI primitives in-tree, Pages Function per-route mapping with server-side startup_id resolution); deploy → DEFER-28.5-02-A (blocked by DEFER-28.5-01-C)
Current phase: 28.5 (Startups Web App + Clerk #3 + Per-Startup Agent Email)
Current plan: 28.5-03 ✓ shipped 2026-05-25 (code-complete + deploy-ready); next is 28.5-04 (apps/startup/ Worker email handler + migration 0013 — peer's wave-3 territory) and 28.5-05 (Clerk webhook)
Blockers: None for executor; pilot-readiness gated on DEFER-28.5-01-A..G + DEFER-28.5-02-A (see PHASE-28.5-DEFERRED-OPS.md)
Deferred to v1.5:
- `NEONEX-VER-WORKER-LIVE-01` — 5-step Clerk-JWT probe of Workspace Worker `/api/ops/safety/*` (see 24-01-SUMMARY.md). Code-verified PASS; live-HTTP confirmation needs a browser session.
- `DEFER-28.5-01-A..G` — Clerk #3 wrangler secret injection, Clerk frontend-api CNAME, CF Pages project + custom domain, CF Email Routing domain verify (SPF/DKIM/DMARC), catch-all → Worker, Clerk webhook signing secret, DNS propagation check. See `.planning/milestones/v1.4-pilot-readiness/phases/28.5-startups-web-app/PHASE-28.5-DEFERRED-OPS.md`.

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

- **Phase 28.5** — Startups Web App + Clerk #3 + Per-Startup Agent Email *(current — 3/5 plans shipped)*
- **Phase 29** — Startup Telnyx SMS + Voice AI + Voice-Based Onboarding

## Phase 28.5 plan summary

| Plan | Objective | Wave | Deps | Status |
|------|-----------|------|------|--------|
| 28.5-01 | Clerk app #3 + DNS + Email Routing bootstrap (STARTUPS_CLERK_* wrangler stubs + PHASE-28.5-DEFERRED-OPS.md backlog) | 1 | none | ✓ Shipped 2026-05-25 (auto portion; 7-step external-ops checkpoint → DEFERRED-OPS.md) |
| 28.5-02 | apps/startups Vite+React+Clerk scaffold + sign-in + dashboard skeleton + Pages Function proxy + Fly identity endpoint | 2 | 28.5-01 | ✓ Shipped 2026-05-25 (code-complete; deploy → DEFER-28.5-02-A) |
| 28.5-03 | Live founder dashboard + role form + thread reply UI + Pages Function route mapping (per-route /api/me, /api/roles, /api/threads, /api/threads/:id/reply with server-side startup_id resolution) | 3 | 28.5-02 | ✓ Shipped 2026-05-25 (code-complete; deploy → DEFER-28.5-02-A) |
| 28.5-04 | apps/startup/ Worker email handler + migration 0013 + slug assignment (peer's wave-3 parallel territory) | 3 | 28.5-02 | In progress (peer executor-28.5-04) |
| 28.5-05 | Clerk webhook (user.created → startup_members.clerk_user_id) | 4 | 28.5-03 + 28.5-04 | Planned |

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
