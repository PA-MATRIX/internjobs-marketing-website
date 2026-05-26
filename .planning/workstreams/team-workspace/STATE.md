---
schema_version: 1
team: "team-workspace"
milestone: "v1.4"
status: "executing"
last_activity: "2026-05-26"
---

# team-workspace Workstream State

## Source Of Truth

- GitHub issue/phase assignment owns task status.
- GitHub branch/PR owns code status.
- This file is local execution memory for RRR only.
- Root `.planning/STATE.md` is coordinator-owned in team mode — DO NOT WRITE TO IT.

## Assignment

GitHub team: @PA-MATRIX/team-workspace
Branch: rrr/v1.4/team-workspace-25 (Phase 25 per-phase branch)
Sprite: rrr-internjobs-marketing-website-v1-4-team-workspace
Phases: 23, 25, 26, 27

## Current Position

Status: Phase 25 in progress — 25-02 + 25-03 closed, 25-01 deferred (operator window)
Current phase: 25 (SSO Activation + Admin UX)
Current plan: 25-02 closed 2026-05-26 (admin UX brand refit — code-complete, browser visual verify deferred)
Last activity: 2026-05-26 — Completed 25-02-PLAN.md (ADMIN-UX-01..04 brand refit)
Blockers: None for 25-02 + 25-03; 25-01 awaits operator mmctl credentials

## Phase 25 Plan Summary

Branch: rrr/v1.4/team-workspace-25
Phase dir: .planning/milestones/v1.4-pilot-readiness/phases/25-sso-activation-admin-ux/

| Plan | Wave | Autonomous | Status | Objective |
|------|------|------------|--------|-----------|
| 25-01 | 1 | false | deferred | mmctl runbook + SSO activation script (MMSSO-01, MMSSO-03 native) — deferred pending operator credentials |
| 25-02 | 1 | true | **closed 2026-05-26** | Brand-refit /admin + /admin/invite with v1.4 brand tokens (ADMIN-UX-01..04) — commits `eb303e9`, `5042bc9`, `f97373d` |
| 25-03 | 1 | true | **closed 2026-05-26** | Remove @neondatabase/serverless dep (NEONEX-DEP-01) — commit `ebe3822` |

All 3 plans in Wave 1 — can execute in parallel (no shared file overlap: 25-01 touches test/, 25-02 touches app/routes/ + index.css, 25-03 touches package.json + package-lock.json).

## Key Decisions for Phase 25

- **Admin UX is already built** (v1.2 Phase 16): admin.tsx + admin.invite.tsx + admin-employees.ts are all fully functional. Phase 25 scope is a BRAND REFIT (CSS tokens, no logic changes) not a build.
- **MMSSO-03 is native Mattermost behavior**: when /oidc/userinfo returns the correct claims, Mattermost auto-provisions users. No code change required. Runbook explains this.
- **MMSSO-02 deferred**: live SSO test requires mmctl operator access + fly machine restart. Plan 25-01 ships runbook + script; live execution is in a separate operator window.
- **Brand token source**: BRAND-V1.md §1 — var(--lavender) background, var(--ink) text, var(--cobalt) CTA, var(--lime) active pills. Inter font via Google Fonts @import.
- **@neondatabase/serverless has zero imports in apps/parrot/workers/**: confirmed by grep. Pure package.json cleanup.
- **Plan 25-03 closure (2026-05-26)**: `npm uninstall @neondatabase/serverless` ran clean (`removed 1 package`); `npm run build` passes; 2 transitive optional-peerDep refs remain inside `drizzle-orm` (acceptable — drizzle advertises optional Neon support, no install resolution). Commit `ebe3822`. SUMMARY: 25-03-SUMMARY.md.
- **Pre-existing audit findings**: `npm uninstall` output reported 6 vulnerabilities (4 moderate, 2 high) in apps/parrot. Out of scope for 25-03. Candidate for a dedicated v1.4 security/audit plan.
- **Plan 25-02 closure (2026-05-26)**: brand-refit shipped in 3 atomic commits (`eb303e9` index.css tokens + Inter, `5042bc9` admin.tsx + Fragment key fix, `f97373d` admin.invite.tsx). `npx tsc --noEmit` zero errors; `npm run build` clean (admin chunks 8.36 kB + 7.56 kB). Grep audit: zero `bg-white`/hex literals in admin*.tsx; only surviving slate/emerald are inside `StatusBadge` (UI-state edge case, explicitly preserved per plan). Browser visual verify deferred to operator window — same pattern as Phase 23 ATTACH-DOWN. SUMMARY: 25-02-SUMMARY.md.
- **Plan 25-02 cream-on-admin decision**: BRAND-V1 §1 Hard Rule #5 names cream as the only escape from lavender and mentions "long-form (blog, legal)". Admin dense data tables + multi-field forms interpreted as similar dense surfaces benefiting from cream. No white anywhere.
- **Plan 25-02 follow-ups**: (a) workspace-wide brand refit for dashboard/meetings/chat/inbox/login/WorkspaceShell still pending; (b) visual verify screenshot capture → 25-02-VISUAL-VERIFY.md if pilot operator wants formal proof.

## Notes

Owns the worker-side **Workspace** app. Code paths still use `apps/parrot/` (the
worker is named `internjobs-parrot` in Cloudflare); the verbal/written reference
in planning docs is **Workspace** to avoid confusion with an unrelated, now-deleted
Neon project that was also called "parrot".
