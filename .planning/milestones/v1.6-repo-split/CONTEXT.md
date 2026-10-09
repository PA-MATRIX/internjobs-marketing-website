# v1.6 Repo Split + Code Mapping — Context

**Status:** Opened 2026-10-08. Planning + read-only mapping may start now; no repo/GitHub changes until the plan is checker-approved and Raj approves each live action.
**Includes Nithin's v1.5 merge (Raj, 2026-10-08):** promoting `integration/v1.5` -> `main` is Phase 0 of this milestone, so the split runs on top of his finished work and never conflicts with it. Split work must not edit v1.5 phase code before that merge lands.

## Intent (Raj, 2026-10-08)
1. Map all three Intern Jobs codebases with RRR code mapping BEFORE any split.
2. `internjobs-cms` must be JUST the public marketing website (`apps/marketing`) and be protected.
3. Everything else (student `apps/app`, `apps/employers`, `apps/startup`, Workspace `apps/parrot`, `apps/mac-bridge`, workers, `packages/shared`) goes to a separate private platform repo/folder.
4. Map GitHub repos <-> local folders so there is no confusion.

## Phase 0 — merge Nithin's v1.5 work into main (prerequisite to the split)
State checked 2026-10-08: `integration/v1.5` is 86 commits / 101 files (+14,238/-423) ahead of `main`; main is 0 ahead (clean fast promote). Merged into integration via PRs #24 (Phase 33 Startups web app go-live), #25 (Phase 36 Lakera quarantine + fail-open), #26 (Phase 32 Parrot dialer embed), each with `submissions/<phase>.json` markers (32, 33, 36).
- **Phases 34 (Telnyx go-live) and 35 (first pilot install) have NO submission marker** — not done as far as the repo shows. Raj believes Nithin is finished; confirm with Nithin whether 34/35 are done, deferred, or dropped before promoting.
- Promote via `/rrr:coordinate-merge` / PR `integration/v1.5` -> `main` (ruleset: PR + CI + submission gate). Run `/rrr:audit-milestone` for v1.5 first, then close v1.5.
- Only after this lands: freeze `main`, then start the split.

## Decisions
- **D1 — Parrot stays where it is:** `PA-Ai-Team/Parrot` (local `~/Documents/Parrot`) is NOT moved to PA-MATRIX. (Raj, 2026-10-08)
- **D2 — Two repos/folders:** public website-only repo + private platform repo, both under PA-MATRIX. (Raj: "clean two folder split")
- **D3 — Legacy:** `growthpods/Internjobs` (`~/MayaOS/internjobs-ai`) archived after its 4 uncommitted files are resolved.
- **D4 — Registered as v1.6.** Research skipped; code mapping is the research.
- **D8 — v1.5 Phases 34 (Telnyx go-live) and 35 (first pilot install) recorded as DEFERRED (Raj, 2026-10-08: "leave that alone and lets move on").** Checked 2026-10-08: no branch, PR or submission marker for 34/35; Nithin has no open PRs; latest work is Phases 32/33/36 (last push 2026-08-12, PR #26 merged 2026-09-23). v1.5 closes as PARTIAL: delivered 32, 33, 36; deferred 34, 35 (carry to a later milestone). No further chasing of Nithin in this milestone. MERGE-01 satisfied by this record.
- **D9 — Raj pre-approves the v1.5 promotion merge (2026-10-08, "proceed with any pr merges if needed").** Scope, as I (Claude) apply it: ONLY the promotion PR `integration/v1.5` -> `main`, as a MERGE COMMIT (no squash/rebase, no admin bypass, no force-push, no branch deletion), pinned to the `integration/v1.5` tip sha read at pre-flight, and ONLY after plan 37-02's gates pass (37-01 verifier passed, `--preflight-checks` exit 0, 4 required checks SUCCESS, `--expect-head` matches). Any surprise (new commits on either branch, a failing required check, conflicts, protection drift) = STOP and report; this approval does not cover them. NOT covered: merging PR #27 (stays open until the Phase 37 verifier passes, then merges as the closing step of 37-03 and needs a separate go-ahead), deleting `integration/v1.5`, any visibility/rename/archive step (Phase 41), anything in `PA-Ai-Team/Parrot`.
- **D9 OUTCOME (2026-10-08): promotion merged.** At the gate Raj answered explicitly "Approve: merge #28 now". PR #28 (`integration/v1.5` -> `main`) MERGED as a merge commit `4c182d3` (parents 13b0a5e + 1ecddd9); `integration/v1.5` kept at 1ecddd9; no squash, no admin bypass, no force-push. Checks: 4 required SUCCESS (submission gate (rrr), workspaces (marketing · app · employers), workspace worker (parrot), startups worker (typecheck · tests)) plus 2 extra SUCCESS (email timeout invariant (cross-package), email worker (tests)). Two verifier advisories were shown to Raj before he approved (Phase 32/33 verifiers returned human_needed; audit recorded as gaps_accepted with 9 named gaps). `verify-v15-promotion.mjs --post --pr 28` exit 0 (tip 1ecddd9 is an ancestor of origin/main; markers 32/33/36 on main). PR #27 and branch deletion remain NOT approved.
- **D10 — `main` frozen to non-v1.6 changes until the split lands (Phase 41); PROCESS RULE ONLY (Raj's MERGE-04 intent; recorded 2026-10-08).** PA-MATRIX is on the free plan, which cannot enforce this on a private repo, and 37-03 adds NO new ruleset. The check is a readback: `node scripts/verify-v15-promotion.mjs --freeze` (fed by `gh pr list --state open --base main --json number,headRefName,title`) exits 0 only when every open PR against `main` is a v1.6 docs/split branch; right now the only such PR must be PR #27. PR #27 itself merges only after the phase-level rrr-verifier passes and with Raj's separate go-ahead.
- **D5 — Nithin's v1.5 merge is combined into this milestone as Phase 0.** (Raj, 2026-10-08)

## Decisions confirmed 2026-10-08 (Raj: "proceed with your recommendations")
- **D6 — New cms repo = fresh start (no history)**, safest for a public repo.
- **D7 — Do NOT flip the current public repo to private yet.** PA-MATRIX is on GitHub's FREE plan: private repos there do not enforce branch protection/rulesets, so going private could silently drop the `main` protection + `integration/**` submission gate. Requirement: verify plan/feature limits (upgrade org to Team, or keep protected repos public-but-sanitised) BEFORE any visibility change; platform repo must be private AND protected, so the plan question gates its creation.

## Open decisions (need Raj before the plan is final)
- Repo names (`internjobs-cms` / `internjobs-platform`) and local layout (`~/internjobs/{cms,platform,parrot}`).
- Whether `apps/parrot` (monorepo Workspace) vs `PA-Ai-Team/Parrot` relationship needs any change (map first).

## Audit facts (2026-10-08, read-only)
- No real secrets in `internjobs-cms` tree or git history (all matches are placeholders/comments); legacy repo clean; `PA-Ai-Team/Parrot` NOT yet scanned.
- Public repo exposes `.planning/`, infra docs, Infisical project paths, credential-rotation runbook.
- Secret scanning + push protection DISABLED on `PA-MATRIX/internjobs-marketing-website`.
- `main` protected: reviews required + 4 CI checks (`workspaces (marketing · app · employers)`, `workspace worker (parrot)`, `startups worker (typecheck · tests)`, `submission gate (rrr)`). `.github/workflows/ci.yml` hard-codes this layout.
- Collaborators: jsriya14 (admin), growthpods (admin), nithinpotti (write), vamshiparvatham (read).
- 19 remote branches, stale: `phase-07b`, `phase-09`, `phase-10`, `rrr/v1.4/*`, 2 worktree-agent branches.
- `~/Documents/Parrot` local clone is 664 commits behind origin/main; two extra worktrees (`Parrot-wt-dedupe`, `Parrot-wt-main-port`). Sync before mapping.
- Existing `.planning/codebase/` maps exist for cms and Parrot (staleness unknown); legacy has none.

## Repo <-> local map (today)
| GitHub | Visibility | Local |
|---|---|---|
| PA-MATRIX/internjobs-marketing-website | Public | ~/internjobs-cms |
| PA-Ai-Team/Parrot | Private | ~/Documents/Parrot (+2 worktrees) |
| growthpods/Internjobs | Private | ~/MayaOS/internjobs-ai |

## Rules for this milestone
- TDD-first plans; rrr-plan-checker before execution; rrr-verifier per plan.
- Before moving anything, grep every repo for every place the layout/paths are enforced (CI, wrangler, deploy, STATE, `packages/shared` imports) and list each with its disposition.
- Live GitHub actions (rename/transfer/visibility/archive) run as executor tasks with Raj's approval recorded first.
- Run `/rrr:audit-milestone` before calling it done.

## v1.5 Phase 34/35 status (MERGE-01)

- Phase 34: deferred — confirmed by Raj on 2026-10-08: D8; no branch, PR or submission marker on integration/v1.5
- Phase 35: deferred — confirmed by Raj on 2026-10-08: D8; no branch, PR or submission marker on integration/v1.5
