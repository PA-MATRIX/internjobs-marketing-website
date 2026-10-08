# v1.6 Repo Split + Code Mapping — Context

**Status:** Queued after v1.5 (opened 2026-10-08). Planning + read-only mapping may start now; no repo/GitHub changes until the plan is checker-approved and Raj approves each live action.
**Does not touch:** v1.5, `integration/v1.5`, team-workspace/Nithin's phases 32–36.

## Intent (Raj, 2026-10-08)
1. Map all three Intern Jobs codebases with RRR code mapping BEFORE any split.
2. `internjobs-cms` must be JUST the public marketing website (`apps/marketing`) and be protected.
3. Everything else (student `apps/app`, `apps/employers`, `apps/startup`, Workspace `apps/parrot`, `apps/mac-bridge`, workers, `packages/shared`) goes to a separate private platform repo/folder.
4. Map GitHub repos <-> local folders so there is no confusion.

## Decisions
- **D1 — Parrot stays where it is:** `PA-Ai-Team/Parrot` (local `~/Documents/Parrot`) is NOT moved to PA-MATRIX. (Raj, 2026-10-08)
- **D2 — Two repos/folders:** public website-only repo + private platform repo, both under PA-MATRIX. (Raj: "clean two folder split")
- **D3 — Legacy:** `growthpods/Internjobs` (`~/MayaOS/internjobs-ai`) archived after its 4 uncommitted files are resolved.
- **D4 — Registered as v1.6, queued after v1.5.** Research skipped; code mapping is the research.

## Open decisions (need Raj before the plan is final)
- Make the public repo private immediately (before the split)?
- New cms repo: full history vs fresh start (fresh start safer for a public repo).
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
