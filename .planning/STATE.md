---
schema_version: 2
milestone: "v1.4"
phase: 22
phase_name: "Lakera Verification + Marketing Brand Refresh"
phase_total: 6
plan: 4
plan_total: 5
status: "in_progress"
progress: 3
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
Plan: 22-01 + 22-03 + 22-04 complete (Lakera v2 + brand foundation + brand surface apply); 22-05 next (marketing visual verification)
Status: In progress — Lakera track done, brand track wave-2 done
Last activity: 2026-05-24 — 22-04 executed (apex + /startups hero rewrites, data-accent system wired, OG image generated via sharp, 5+6 hex literals purged from marketing surfaces; 3 commits; all 11 plan verify-checks pass; build green)

Progress: ██░░░░░░░░ 4% (3/68 requirements done; 8 brand reqs verified by 22-03; LAKERA-V2-01/02/03 by 22-01; 17 brand-layout/logo/copy reqs by 22-04)

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
| 22 | 3 | 5 | ~13 min (22-03: ~3 min, 22-01: ~25 min, 22-04: ~12 min) |
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

### Pending Todos

- Optional: `/rrr:assign-phases` to formalize team assignments in `.planning/team-mode.json`
- `/rrr:plan-phase 22` to draft Phase 22 plans (team-cms first to unblock 23)
- `/rrr:dispatch-team --team team-workspace` once 22 is in plan stage so team-workspace can start work on phase 23 prep
- CODEOWNERS file at `.github/CODEOWNERS` per the team scope split (deferred — drafted in earlier session, not yet committed)
- Branch protection on `main` requiring CODEOWNERS approval

### Blockers/Concerns

None blocking start of Phase 22. ✅ Lakera (Cisco AI Defense) API drift resolved by 22-01 — LAKERA-V2-01/02/03 all verified; SAFETY-VERIFY-LIVE-* tests in Phase 23 are now meaningful (hard-block gate actually fires on flagged injections). Follow-up (not blocking): dashboard sign-in to confirm tier/quota for the 30k/month pilot — see `infra/LAKERA-PRICING.md` "Tier assessment" section.

Pre-existing TS error in `apps/parrot/workers/types.ts:55` (`STUDENT_API_URL` discriminated type — `string | undefined` vs string-literal). Reproduces on `main` without 22-01 changes. Not a 22-01 regression but worth a future house-keeping pass.

## Session Continuity

Last session: 2026-05-24 — Phase 22 brand track wave-2 shipped. 22-04 (Marketing Layout & Copy) executed in ~12min: rewrote apex `/` hero with lime accent + "internships, in your dms." + lime pill CTA; rewrote `/startups` hero with cobalt accent + "hire interns by text, not by tower of resumes." + cobalt pill CTA; wired data-accent="lime|cobalt|lime" page attribute system on apex/startup/legal wrappers so .accent-comma/.accent-dot inherit accent colors via CSS from 22-03; mounted lockup-gradient-ink.svg in apex Navbar + lockup-lavender.svg in StartupNavbar (cobalt exception per BRAND-LOGO-04); generated 1200x630 OG PNG via sharp (no new dep) + wired full OG + Twitter Card meta tag suite; purged 5 marketing-surface hex literals in App.tsx + 6 in styles.css → all brand tokens; lowercased 28 user-visible "InternJobs.ai" copy refs to "internjobs.ai" (legal intro defs preserved per BRAND-COPY-07 exception); zero corp-speak grep hits. All 11 plan verify checks pass + build green (41.68 kB CSS, 1.37s). 3 atomic commits + metadata.
Stopped at: 22-04 complete. Ready for 22-05 (Marketing Visual Verification — playwright contrast checks, OG card smoke-test via Twitter/Facebook validators, accessibility AA check).
Resume file: `.planning/milestones/v1.4-pilot-readiness/phases/22-lakera-and-brand-refresh/22-05-PLAN.md`
