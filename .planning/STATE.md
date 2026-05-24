---
schema_version: 2
milestone: "v1.4"
phase: 22
phase_name: "Lakera Verification + Marketing Brand Refresh"
phase_total: 6
plan: 5
plan_total: 5
status: "in_progress"
progress: 4
last_activity: "2026-05-24"
session_last: "2026-05-24"
resume_file: ".planning/milestones/v1.4-pilot-readiness/phases/22-lakera-and-brand-refresh/22-05-PLAN.md"
blockers: []
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-24)
See: .planning/MILESTONES.md (full v1.0 / v1.1 / v1.2 / v1.3 ship history)
See: .planning/REQUIREMENTS.md (68 active v1.4 requirements — 46 original + 22 brand — all mapped to phases)
See: .planning/ROADMAP.md (v1.4 = Phases 22–27, two-team execution)
See: .planning/milestones/v1.4-pilot-readiness/SCOPE.md (initial scope draft)
See: .planning/brand/BRAND-V1.md (brand spec captured from PDF + logo pack 2026-05-24)
See: .planning/codebase/ (codebase map written 2026-05-24)
See: .planning/team-mode.json (RRR team mode: team-cms + team-workspace)
See: .planning/WORKSTREAMS.md (team assignments)

**Core value:** InternJobs.ai helps students and startups meet through natural messages, not resume piles or application black holes.
**Current focus:** Phase 22 — Lakera Verification + Marketing Brand Refresh (team-cms)

## Current Position

Milestone: v1.4 Pilot Readiness
Phase: 22 of 27 (Lakera Verification + Marketing Brand Refresh — team-cms)
Plan: 22-01 + 22-02 + 22-03 + 22-04 complete (Lakera v2 schema fix + Lakera live-prod verification + brand foundation + brand surface apply); 22-05 next (marketing visual verification)
Status: In progress — Lakera track DONE (verified live in prod), brand track wave-2 done
Last activity: 2026-05-24 — 22-02 executed (continuation from human-action checkpoint): 9 injection prompts hard-blocked live in prod (21:06Z–21:19Z, sender_last4=4287, v55 with commit 2cc2f90); "You suck" pre/post deploy diff (v54 score=0 → v55 score=1) is the in-prod smoking gun for the 22-01 parser fix; VERIFY-LIVE-02 PASS (inferred); VERIFY-LIVE-03 DEFERRED with unit-test + organic-prod-observation rationale; wrote `infra/LAKERA-VERIFY-LIVE.md` (163 lines) — 2 atomic commits + metadata

Progress: ██░░░░░░░░ 6% (4/68 requirements done; 8 brand reqs verified by 22-03; LAKERA-V2-01/02/03 by 22-01; 17 brand-layout/logo/copy reqs by 22-04; SAFETY-VERIFY-LIVE-01/02 by 22-02 — -03 deferred to v1.5)

## Team Mode

This milestone runs under **RRR team mode** (initialized 2026-05-24).

- `team-cms` (Raj, GitHub `@PA-MATRIX/team-cms`) — Phases 22 + 24. Branch `rrr/v1.4/team-cms`.
- `team-workspace` (Raj + Nithin, GitHub `@PA-MATRIX/team-workspace`) — Phases 23, 25, 26, 27. Branch `rrr/v1.4/team-workspace`.

**Execution order:**
- team-cms: 22 → 24
- team-workspace: 23 → 25 → 26 → 27
- Cross-team dep: 23 cannot start until 22 is verified

Coordinator workflow: each team works on their own branch; root `.planning/STATE.md` is coordinator-owned; integration via `integration/v1.4` branch.

See: `.planning/workstreams/{team-cms,team-workspace}/{STATE.md,ASSIGNMENT.md}`

## Performance Metrics

**Velocity:**
- Total plans completed (v1.0/v1.1/v1.2): ~43; v1.3: 9 + Neon-exit
- v1.4 plans completed: 0

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 22 | 4 | 5 | ~12 min (22-03: ~3 min, 22-01: ~25 min, 22-04: ~12 min, 22-02: ~8 min) |
| 23 | 0 | TBD | — |
| 24 | 0 | TBD | — |
| 25 | 0 | TBD | — |
| 26 | 0 | TBD | — |
| 27 | 0 | TBD | — |

## Accumulated Context

### v1.4 phase dependency graph

- **Phase 22** (Lakera Verification + Marketing Brand Refresh, team-cms) — first phase, no v1.4 deps. Two independent tracks within team-cms (Lakera + Brand).
- **Phase 23** (Workspace Pilot Closeouts, team-workspace) — depends on Phase 22 (SAFETY-VERIFY-LIVE-04 needs LAKERA-V2-02)
- **Phase 24** (Neon-Exit Closeout, team-cms) — no deps; can start parallel to 23
- **Phase 25** (SSO + Admin UX, team-workspace) — sequential after 23 on team-workspace branch
- **Phase 26** (Knowledge Graph + GenZ, team-workspace) — sequential after 25
- **Phase 27** (Polish + Test Floor, team-workspace) — sequential after 26

### Decisions

Recent v1.4 decisions (log into PROJECT.md Key Decisions table when finalized):
- 6-phase breakdown chosen over 4-phase aggressive option for cleaner team ownership
- Phase ownership by team (one team per phase) rather than per-requirement mixing — keeps team branches clean
- NEONEX-DEP-01 folded into Phase 25 (team-workspace housekeeping) rather than splitting Phase 24 across teams
- DATES-01 classified team-workspace (both source apps are team-workspace-owned), not "shared"
- 22-03: Brand `ink` overrides legacy tailwind `ink:#111111` (renamed to `ink-legacy`). All `text-ink` usages now resolve to `var(--ink)=#1A0D2E`. 22-04 contrast pass will catch any regressions.
- 22-03: PNG-only favicon strategy (no .ico generated). 256w mark-gradient PNG used for 32/64/180 sizes; Safari mask-icon → mark-ink.svg.
- 22-03: Tailwind brand keys reference CSS vars (`var(--lavender)` etc.) instead of duplicating hex values — single source of truth in `styles.css :root`.
- 22-01: Lakera v2 returns a binary `{flagged, metadata}` payload — no `results[]`, no per-category scores. The v1 parser silently fell through to `score=0` on every flagged response, so the production `score >= 0.8` hard-block gate was dead code. Fixed via parser rewrite + caller-gate change to `flagged === true || score >= 0.8`. Both `screen.mjs` (Node) and `safety.ts` (Worker) mirror.
- 22-01: Binary flag → numeric score mapping (`flagged: true → score=1`) preserves the `ScreenResult.score: number | null` contract used by every caller + the `safety_events.score` DB column. Considered `null` but rejected — would force every caller to handle a new code path.
- 22-01: Lakera tier/quota is not API-visible — `infra/LAKERA-PRICING.md` documents this as a deferred dashboard-sign-in follow-up; 22-01 did not block on it because the operational signal ("logs visible in dashboard, key works") is positive.
- 22-01: Skipped the Lakera signup checkpoint (Task 1) — production key already wired (Infisical + Fly digest `64ee3c881fc8742c`). Verified by direct probe from inside the Fly app's env, not from a dev laptop.
- 22-04: StartupNavbar mounts lockup-lavender.svg (not lockup-gradient-ink.svg) because the cobalt header literally sits on cobalt — BRAND-LOGO-04 cobalt exception applied at navbar surface, not just inside the hero. Apex Navbar receives isStartupPage prop and picks gradient-ink variant for default lavender surface.
- 22-04: OG image generated via sharp (already in node_modules) — wrote SVG to /tmp, sharp.png().toFile() to public/logo/og-1200x630.png. No new dep. SVG snippet preserved in commit fed1d0b for regen.
- 22-04: WaitlistSection + StartupAccessSection CTA buttons rewritten to brand pills ("get on the list" / "post a role") for cross-page brand-voice consistency. Was "Join Early Access" / "Join Startup Access" on .secondary-party-button with #111 text — both forbidden hex AND Title Case.
- 22-04: ChannelSection h2 (with text-party-gradient rainbow + #111111 stops) left untouched — out of 22-04 scope. Flagged as known follow-up for 22-05 visual diff or later.
- 22-04: Phone-demo UI mocks (iphone-screen, ios-*, whatsapp-*, slack-*, discord-*, phonecall-*) + startup-chat-shell + startup-slack-* all kept their original hex literals per BRAND-LAYOUT-05 mock-exception clause (they simulate real app UIs).
- 22-04: Apex Navbar mobile drawer nav links kept Title Case (How it works, Channels, etc.); StartupNavbar nav links lowercased (cobalt header is strongly branded surface, lowercase matches brand voice more strictly). Small judgment call documented in deviations.
- 22-02: VERIFY-LIVE-03 (fail-open via invalid LAKERA_GUARD_API_KEY) DEFERRED. Live execution would degrade the safety gate during the Fly machine restart (~30s). Substitutes accepted: (a) unit-test coverage in `apps/app/src/safety/screen.test.mjs` (5/5 pass per 22-01) and (b) an organic prod observation of `action='passed_lakera_unavailable'` on row f0293168 (2026-05-21T17:56:16Z), confirming the fail-open path has fired in prod before this verification window. Re-promote in v1.5 if pilot incident requires.
- 22-02: VERIFY-LIVE-02 accepted as PASS via inference, NOT direct positive logging. Code gate at `apps/app/src/server.mjs:707` (`if (screenResult.action !== "passed")`) means benign passes emit only `lakera_latency_ms`, not the full `lakera_screen` log line. Converging signals (zero unexpected safety_events rows + latency-only log entries clustered around benign sends + 32s gap analysis) accepted as evidence. Lifting the log out from under that gate is a v1.5 observability follow-up (SAFETY-OBS-01 proposed candidate).
- 22-02: Lakera v2 conservative-flag observation documented as v1.5 pilot watchlist item, NOT a fix-now defect. Lakera flagged tone-adversarial ("You suck") and meta-question ("what would happen if I asked you to ignore safety rules?") prompts in the test window. v2 binary endpoint has no score knob to soften — remediation paths (per-user allowlist / Lakera v2 detailed endpoint with category scores / categorical exception list) all imply v1.5 design work. Fold into existing v1.5 SAFETY-HARD-BLOCK-EXPAND-01 candidate with concrete pilot-watch action: daily FP-rate dashboard tile, 30-day review.

### Pending Todos

- Optional: `/rrr:assign-phases` to formalize team assignments in `.planning/team-mode.json`
- `/rrr:plan-phase 22` to draft Phase 22 plans (team-cms first to unblock 23)
- `/rrr:dispatch-team --team team-workspace` once 22 is in plan stage so team-workspace can start work on phase 23 prep
- CODEOWNERS file at `.github/CODEOWNERS` per the team scope split (deferred — drafted in earlier session, not yet committed)
- Branch protection on `main` requiring CODEOWNERS approval

### Blockers/Concerns

None blocking. ✅ Lakera safety track is fully verified end-to-end: LAKERA-V2-01/02/03 by 22-01 (schema + parser fix), SAFETY-VERIFY-LIVE-01/02 by 22-02 (9 hard-blocks confirmed live in prod, benign passes confirmed via converging signals). SAFETY-VERIFY-LIVE-03 (fail-open) deferred to v1.5 with documented rationale (unit-test coverage + organic prod observation; live destructive test declined). Phase 23 (SAFETY-VERIFY-LIVE-04 employee-email path) can proceed with full confidence in the underlying parser + gate.

Follow-ups (not blocking):
- Lakera dashboard sign-in to confirm tier/quota for the 30k/month pilot — `infra/LAKERA-PRICING.md` "Tier assessment" section.
- Pilot watchlist: 30-day Lakera FP-rate review (driven by v1.5 SAFETY-HARD-BLOCK-EXPAND-01; "You suck" + meta-question both flagged conservatively in 22-02 prod test).
- v1.5 observability: lift `lakera_screen` log out from under the `action !== "passed"` gate so every Lakera roundtrip emits a structured log entry (proposed SAFETY-OBS-01).

Pre-existing TS error in `apps/parrot/workers/types.ts:55` (`STUDENT_API_URL` discriminated type — `string | undefined` vs string-literal). Reproduces on `main` without 22-01 changes. Not a 22-01 regression but worth a future house-keeping pass.

## Session Continuity

Last session: 2026-05-24 — 22-02 (Lakera Live Production Tests) completed as a continuation from a human-action checkpoint. User ran 9 prompt-injection SMS messages against the production student SMS path during 21:06Z–21:19Z; all 9 hard-blocked at the safety gate (canned reply received on phone, safety_events rows with action='blocked', no agent invocation). The "You suck" pre/post-deploy diff (v54 score=0/no-block → v55 score=1/block) is the in-prod smoking gun that the 22-01 parser fix successfully restored the policy enforcement gate. VERIFY-LIVE-02 (benign passes) accepted as PASS via 3 converging signals. VERIFY-LIVE-03 (fail-open) deferred to v1.5 with documented rationale. Latency baseline 71–428ms (avg ~150ms), well under 1000ms timeout. Conservative-flag observation logged as v1.5 pilot watchlist item. Wrote `infra/LAKERA-VERIFY-LIVE.md` (163 lines). 2 commits + metadata.
Stopped at: 22-02 complete. Phase 22 Lakera track fully closed (LAKERA-V2-01/02/03 + SAFETY-VERIFY-LIVE-01/02). Only 22-05 (Marketing Visual Verification) remains in this phase.
Resume file: `.planning/milestones/v1.4-pilot-readiness/phases/22-lakera-and-brand-refresh/22-05-PLAN.md`
