---
phase: 25-sso-activation-admin-ux
plan: "25-01"
status: deferred_to_operator
deferral_reason: "MMSSO-02 live activation requires mmctl admin access to chat.internjobs.ai + fly machine restart permission for internjobs-mattermost — neither credential is available to the autonomous executor; both must come from an operator session."
subsystem: auth
tags: [sso, oidc, mattermost, mmctl, runbook, operator-handoff, oauth, workspace-bridge]

# Dependency graph
requires:
  - phase: v1.2-phase-10-wave-2b
    provides: "OIDC bridge code (apps/parrot/workers/routes/oidc.ts) — /authorize, /token, /userinfo, /jwks, /.well-known/openid-configuration all live at workspace.internjobs.ai"
provides:
  - "Operator runbook to activate Mattermost OIDC SSO via mmctl (MMSSO-01)"
  - "Copy-paste mmctl shell script with 4 env-var guards + 7 config commands"
  - "Documented confirmation that MMSSO-03 (first-login auto-provisioning) is native Mattermost behavior — no code gap"
  - "MMSSO-02 verification checklist with <5s round-trip gate"
affects: [phase-26, phase-27, v1.4-pilot-go-live]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Code-complete-with-deferral: ship runbook + script atomically; defer live execution to operator window; SUMMARY.status=deferred_to_operator (NOT passed/complete) so verifier classifies correctly"
    - "Operator handoff via apps/<service>/test/<phase>-<plan>-*.{md,sh} pair — single runbook + single executable script, no secrets in repo"

key-files:
  created:
    - apps/parrot/test/25-01-mmctl-commands.sh
    - apps/parrot/test/25-01-mattermost-sso-runbook.md
    - .planning/milestones/v1.4-pilot-readiness/phases/25-sso-activation-admin-ux/25-01-SUMMARY.md
  modified:
    - .planning/workstreams/team-workspace/STATE.md

key-decisions:
  - "MMSSO-03 (first-login auto-provisioning) closed as native — zero code change; existing /oidc/userinfo payload already returns email/username/name/id/sub which Mattermost's GitLab OAuth module consumes for auto-create"
  - "MMSSO-02 live verification deferred to operator window — autonomous executor lacks mmctl + fly credentials; this is the canonical Phase 23 deferral pattern"
  - "Shell script ships with 4 env-var guards + set -e — operator cannot accidentally apply partial config"
  - "All 7 mmctl GitLabSettings.* + ServiceSettings.SiteURL commands are atomic in the script; AuthEndpoint/TokenEndpoint/UserApiEndpoint URLs hardcoded to workspace.internjobs.ai/oidc/* (not parameterized — these are repo-canonical endpoints, not operator choices)"
  - "Script committed at mode 100755 via 'git add' + 'git update-index --chmod=+x' (HYGN-01 pattern) so operators on Unix clones get exec bit immediately"

patterns-established:
  - "Operator-handoff bundle: <plan>-<spec>.md (runbook) + <plan>-<spec>.sh (executable) under apps/<svc>/test/ — exact same shape as 23-04's apps/parrot/test/agent-uat-results.md"
  - "SSO/secret-rotation runbooks document Wrangler-CLI retrieval, never Cloudflare dashboard (which masks values)"

# Metrics
duration: 9min
completed: 2026-05-26
---

# Phase 25 Plan 01: Mattermost OIDC SSO Activation Runbook Summary

**Shipped the mmctl runbook + executable shell script for activating Mattermost OIDC SSO; MMSSO-02 live cutover deferred to operator window (no admin credentials in autonomous executor).**

## Performance

- **Duration:** ~9 min (write + verify + commit, two files)
- **Started:** 2026-05-26T16:51:57Z
- **Completed:** 2026-05-26T17:01:22Z
- **Tasks:** 2 auto + 1 non-blocking checkpoint (auto-approved per deferral pattern)
- **Files modified:** 2 (both created) + STATE.md + SUMMARY.md

## Accomplishments

- `apps/parrot/test/25-01-mmctl-commands.sh` — 131-line shell script with `set -e`, 4 env-var guards (MM_OIDC_CLIENT_ID, _SECRET, _REDIRECT_URI, MM_SITE_URL), 7 atomic mmctl commands, and a closing `mmctl config get GitLabSettings` echo. Marked executable (mode 100755) in git index.
- `apps/parrot/test/25-01-mattermost-sso-runbook.md` — 160-line operator runbook: secret inventory (4-row table with Wrangler retrieval commands), pre-flight checks (curl /.well-known + mmctl auth list), execution block (copy-paste export-then-bash), post-run Fly restart, 6-item MMSSO-02 verification checklist with <5s gate, MMSSO-03 native-behavior note, deferral status section.
- **MMSSO-01 closed** — mmctl one-shot is documented + scripted.
- **MMSSO-03 closed as no-op** — confirmed native Mattermost behavior from existing `/oidc/userinfo` payload; no code change required.
- **MMSSO-02 staged for operator** — checklist exists; live verification deferred per blocker.

## Task Commits

Each task was committed atomically:

1. **Task 1: mmctl shell script** — `e8def64` (feat) — `apps/parrot/test/25-01-mmctl-commands.sh` created mode 100755, +131 lines.
2. **Task 2: Operator runbook** — `16b8a6b` (feat) — `apps/parrot/test/25-01-mattermost-sso-runbook.md` created, +160 lines.
3. **Task 3: Checkpoint** — non-blocking; auto-approved per deferral pattern (no commit).

**Plan metadata:** SUMMARY.md + STATE.md update — committed separately as `docs(25-01): complete plan`.

## Files Created/Modified

- `apps/parrot/test/25-01-mmctl-commands.sh` — Operator-runnable shell script. Validates 4 MM_* env vars (exit 1 with retrieval hint on missing), runs 7 mmctl config set-custom commands (GitLabSettings.Enable/Id/Secret/AuthEndpoint/TokenEndpoint/UserApiEndpoint + ServiceSettings.SiteURL), echoes applied GitLabSettings back, prints fly restart + checklist reminder.
- `apps/parrot/test/25-01-mattermost-sso-runbook.md` — Operator-facing markdown runbook. Sections: Secret inventory, Pre-flight checks, Execution, Post-run Mattermost restart, MMSSO-02 verification checklist (6 items, <5s gate), MMSSO-03 auto-provisioning note, Deferral status.
- `.planning/workstreams/team-workspace/STATE.md` — team workstream state updated (Phase 25 Wave 1 progress, 25-01 operator-handoff item added to Open Items).
- `.planning/milestones/v1.4-pilot-readiness/phases/25-sso-activation-admin-ux/25-01-SUMMARY.md` — this file.

## Decisions Made

- **MMSSO-03 (auto-provisioning) closed as native — no code change.** Mattermost's GitLab OAuth module already creates new MM accounts on first login from `/oidc/userinfo` claims (`email`, `username`, `name`, `id`, `sub`). The existing OIDC bridge payload (live since v1.2 Phase 10 Wave 2b) is sufficient. This avoids a phantom code task and is documented inline in the runbook so future plan-readers don't re-litigate.
- **MMSSO-02 deferred to operator window (not failed, not blocked).** The autonomous executor has no mmctl admin credential for chat.internjobs.ai and no Fly deploy permission for `internjobs-mattermost`. Per the Phase 23 precedent (23-02, 23-03, 23-04 all closed with the same pattern), we ship code-complete artifacts now and let the operator do the live cutover in a dedicated window. SUMMARY status = `deferred_to_operator` (not `passed`) so the verifier classifies correctly.
- **Script enforces all-or-nothing config application.** `set -e` at top + 4 env-var guards before any mmctl call. Operator cannot accidentally apply 3/7 commands and leave Mattermost half-configured.
- **GitLab endpoints hardcoded in the script.** `AuthEndpoint`/`TokenEndpoint`/`UserApiEndpoint` URLs (`workspace.internjobs.ai/oidc/*`) are NOT parameterized — they're repo-canonical, not operator choices. Only the 4 secret-bound values (client_id, client_secret, redirect_uri, site_url) are env-var-driven.
- **Script committed at mode 100755 (HYGN-01 pattern).** `git update-index --chmod=+x` ensures Unix clones see the exec bit without manual `chmod +x` step. Verified via post-commit `create mode 100755` in commit `e8def64`.

## Deviations from Plan

None — plan executed exactly as written. All `<verify>` checks passed on first read of each artifact. The non-blocking checkpoint (Task 3) was auto-approved per the deferral-pattern instructions in the spawn objective ("ship the runbook + the mmctl shell script — both committed; do NOT attempt to actually run mmctl or fly machine restart").

## Files Modified drift check

Plan frontmatter `files_modified` declared:

- `apps/parrot/test/25-01-mattermost-sso-runbook.md` -- shipped
- `apps/parrot/test/25-01-mmctl-commands.sh` -- shipped

Actual files in task commits: identical set. **Zero drift.** (SUMMARY.md + STATE.md update are plan-metadata commits, not task commits — per RRR convention they are not subject to the frontmatter drift check.)

## Issues Encountered

None during artifact authoring. Two minor environment notes worth recording:

- `apps/parrot/test/` directory did not exist on this branch; created via `mkdir -p` before the first file write. (Sister files `apps/parrot/test/agent-uat-results.md` from Phase 23-04 live on other branches.)
- Pre-existing repo state at execution start: `apps/parrot/package-lock.json` was modified (from plan 25-03's earlier execution on this branch) and `.planning/.../25-02-SUMMARY.md` was untracked (from plan 25-02). Neither was staged into this plan's commits — only the two files for 25-01 were staged explicitly, no `git add .` used.

## User Setup Required

**This is the entire deferral.** Operator window needs:

1. A workstation with `mmctl` installed and authenticated against `chat.internjobs.ai` (system_admin role).
2. `wrangler` CLI logged into the Cloudflare account owning `internjobs-parrot`, to retrieve `MATTERMOST_OIDC_CLIENT_ID` and `_CLIENT_SECRET` secrets.
3. `fly` CLI logged in with deploy permission for the `internjobs-mattermost` app.

Operator then:

1. Exports 4 `MM_*` env vars (values from Wrangler).
2. Runs `bash apps/parrot/test/25-01-mmctl-commands.sh`.
3. Runs `fly machine restart --app internjobs-mattermost` and waits ~30s.
4. Walks the 6-item MMSSO-02 checklist in the runbook.
5. Ticks "MMSSO-02 verified" in `.planning/workstreams/team-workspace/STATE.md` Open Items.

Expected operator window: ~30 minutes.

## Next Phase Readiness

- **Phase 25 Wave 1 status after this commit:**
  - **25-01** (mmctl SSO runbook) -- **closed code-complete, deferred to operator** for live MMSSO-02 cutover.
  - **25-02** (admin UX brand refit) -- closed (per commit `1ba4984`).
  - **25-03** (drop @neondatabase/serverless) -- closed (per `25-03-SUMMARY.md`).
- **Phase 25 verifier-ready** with the understanding that 25-01's MMSSO-02 is in `deferred_to_operator` state (not `gap_found`).
- **Phase 26/27 unblocked** -- they do not depend on live MMSSO-02 (per ROADMAP.md). Live SSO is a pilot-go-live gate, not a coding gate.
- **No new blockers introduced** by this plan.

---
*Phase: 25-sso-activation-admin-ux*
*Plan: 25-01*
*Status: deferred_to_operator*
*Completed: 2026-05-26*
