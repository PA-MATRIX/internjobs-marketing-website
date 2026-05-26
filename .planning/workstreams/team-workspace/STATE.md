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

Status: Phase 25 Wave 1 closed (3/3 plans done) — 25-01 code-complete + operator-deferred for live MMSSO-02 cutover
Current phase: 25 (SSO Activation + Admin UX)
Current plan: 25-01 closed 2026-05-26 (deferred_to_operator) | 25-02 closed | 25-03 closed
Last activity: 2026-05-26 — Completed 25-01-PLAN.md (MMSSO-01 runbook + script shipped, MMSSO-02 deferred)
Blockers: None (operator-handoff items tracked in Open Items below)

## Open Items

### Operator handoff: Phase 25-01 live MMSSO-02 cutover

**Status:** code-complete / live-verify deferred
**Pattern:** same as Phase 23-02 / 23-03 / 23-04 (ship runbook now, operator runs it)
**Owner:** next operator window with mmctl + wrangler + fly credentials

**Artifacts ready:**
- `apps/parrot/test/25-01-mmctl-commands.sh` (mode 100755, 7 mmctl + 4 env-var guards) — commit `e8def64`
- `apps/parrot/test/25-01-mattermost-sso-runbook.md` (secret inventory, pre-flight, checklist) — commit `16b8a6b`

**Operator steps (~30 min):**
1. Retrieve `MATTERMOST_OIDC_CLIENT_ID` + `MATTERMOST_OIDC_CLIENT_SECRET` via `wrangler secret get` (NOT CF dashboard — values are masked).
2. (Optional) Rotate the client_id/secret pair if either feels stale before activation — re-`wrangler secret put` and use the new values.
3. Export `MM_OIDC_CLIENT_ID`, `MM_OIDC_CLIENT_SECRET`, `MM_OIDC_REDIRECT_URI=https://chat.internjobs.ai/signup/gitlab/complete`, `MM_SITE_URL=https://chat.internjobs.ai`.
4. Run `bash apps/parrot/test/25-01-mmctl-commands.sh`.
5. Run `fly machine restart --app internjobs-mattermost` and wait ~30s for cold boot.
6. Walk 6-item MMSSO-02 verification checklist in the runbook — incognito browser, measure <5s round-trip.
7. Verify MMSSO-03 auto-provisioning by signing in as a new invite (workspace email never seen by Mattermost before).
8. Tick MMSSO-02 + MMSSO-03 verified here in this Open Items section — then this section can be removed.

**Blocker rationale (why this is deferred, not failed):**
Autonomous executor has no mmctl admin credential against chat.internjobs.ai and no Fly deploy permission for internjobs-mattermost. Both are operator-only credentials per Phase 23 precedent. This is `deferred_to_operator`, NOT `gap_found` — Phase 26/27 are unblocked.

### Operator handoff: Phase 25-02 admin UX visual verify (carried over)

Browser screenshot verification for admin brand refit still deferred per 25-02 SUMMARY. Same operator window can take ~5 min to walk /admin + /admin/invite in incognito and confirm lavender/ink/cobalt tokens are applied.

## Phase 25 Plan Summary

Branch: rrr/v1.4/team-workspace-25
Phase dir: .planning/milestones/v1.4-pilot-readiness/phases/25-sso-activation-admin-ux/

| Plan | Wave | Autonomous | Status | Objective |
|------|------|------------|--------|-----------|
| 25-01 | 1 | false | **closed 2026-05-26 (deferred_to_operator)** | mmctl runbook + SSO activation script (MMSSO-01 closed, MMSSO-03 native, MMSSO-02 operator-deferred) — commits `e8def64` (script), `16b8a6b` (runbook). SUMMARY: 25-01-SUMMARY.md |
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
- **Plan 25-01 closure (2026-05-26)**: shipped `apps/parrot/test/25-01-mmctl-commands.sh` (mode 100755, 7 mmctl GitLabSettings + SiteURL commands, 4 env-var guards) and `apps/parrot/test/25-01-mattermost-sso-runbook.md` (4-row secret inventory, pre-flight curl + mmctl auth check, 6-item MMSSO-02 verification checklist with <5s gate, MMSSO-03 native-behavior note, deferral status). MMSSO-01 closed via script; MMSSO-03 closed as native Mattermost behavior (no code change — existing /oidc/userinfo payload sufficient); MMSSO-02 deferred to operator window. SUMMARY status = `deferred_to_operator` (not `passed`). Commits `e8def64` + `16b8a6b`. SUMMARY: 25-01-SUMMARY.md.

## Notes

Owns the worker-side **Workspace** app. Code paths still use `apps/parrot/` (the
worker is named `internjobs-parrot` in Cloudflare); the verbal/written reference
in planning docs is **Workspace** to avoid confusion with an unrelated, now-deleted
Neon project that was also called "parrot".
