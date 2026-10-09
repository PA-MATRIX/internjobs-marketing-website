---
phase: 37-merge-v1.5
plan: 02
verified: 2026-10-08
status: passed
score: 6/6 must-haves verified
re_verification: no
gaps: []
advisories:
  - "SUMMARY's realpathSync wording overstates: the only use is the main-module guard (scripts/verify-v15-promotion.mjs:270, realpathSync(argv[1]) === realpathSync(import.meta.url)), not 'fixture-repo comparisons'. Cosmetic."
  - "Pre-merge live --post RED is cited, not re-run (SUMMARY discloses this honestly); it cannot be re-observed now. Test-suite RED (9 pass / 25 fail) is from a scratchpad file, also not re-run."
  - "37-01-VERIFICATION.md was COMMITTED (2e868d8, 20:20:12) 41s AFTER the merge (4c182d3, 20:19:31 -05:00), but the file was created at 18:44:52 local (stat birth time), before the merge, so the entry gate held; git history alone does not show it."
  - "Phase 32/33 verifiers were human_needed and audit was gaps_accepted (carried from 37-01); shown to Raj before approval per CONTEXT D9 OUTCOME."
  - "gh pr checks 28 lists two runs; the older run shows submission gate skipping (non-PR event), the pull_request run shows it pass (run 37861434028). Gate actually ran."
---

# Phase 37 Plan 02 Verification (MERGE-03)

## Architectural Context Loaded
- No .planning/NORTH-STAR.md consulted for this narrow check. Locked source: CONTEXT.md D9 (merge commit only, no squash/rebase/admin bypass/force-push/branch deletion, PR #27 and PA-Ai-Team/Parrot not covered).

## Observable truths
| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | PR #28 MERGED as true merge commit; tip is ancestor of main; integration/v1.5 still exists | VERIFIED | gh: state MERGED, base main, head integration/v1.5, merge sha 4c182d3; `git rev-list --parents` = 13b0a5e + 1ecddd9 (two parents); merge-base --is-ancestor true; ls-remote shows integration/v1.5 = 1ecddd9; origin/main = 4c182d3 |
| 2 | Markers 32/33/36 and v1.5 phase dirs on main | VERIFIED | `--post` OK for markers 32,33,36; ls-tree shows 32-parrot-embed-pane, 33-startups-web-app-golive, 36-lakera-failopen-quarantine on origin/main |
| 3 | Tests 34/34; --post --pr 28 exit 0; negative control non-zero | VERIFIED | node --test: 34 pass 0 fail; `--post --pr 28` EXIT 0; `--post --pr 27` EXIT 1 (wrong head, not merged, checks in progress) |
| 4 | 4 required checks SUCCESS incl. submission gate; extras reported | VERIFIED | --post and gh pr checks 28: all 4 pass; email timeout invariant + email worker pass reported as INFO |
| 5 | Entry gate held; D9 outcome recorded; SUMMARY RED before GREEN and honest | VERIFIED | 37-01-VERIFICATION status: passed, born 18:44 < merge 20:19; CONTEXT D9 OUTCOME has approval quote, PR, sha, advisories; SUMMARY has RED section before GREEN and discloses cited-not-rerun items (see advisories) |
| 6 | Nothing else changed | VERIFIED | PR #27 OPEN (head docs/open-v1.6-repo-split); ls-remote heads: all prior branches present (integration/v1.4, rrr/v1.4/*, rrr/v1.5/team-workspace-32/33/36 intact); no new PRs; PA-Ai-Team/Parrot not touched by any evidence (no access probed; nothing in repo/PR list references it); working tree only pre-existing untracked files |

Score: 6/6. No blockers. Plan 37-03 entry gate satisfied.
