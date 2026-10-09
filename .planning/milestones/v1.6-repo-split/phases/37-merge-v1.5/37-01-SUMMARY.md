---
phase: 37-merge-v1.5
plan: 01
subsystem: release-gating
tags: [node-test, git-show, promotion-gate]
provides: [scripts/verify-v15-promotion.mjs --pre, 37-AUDIT-v1.5.md, D8/D9 records]
key-files:
  created: [scripts/verify-v15-promotion.mjs, scripts/verify-v15-promotion.test.mjs, 37-AUDIT-v1.5.md, 37-VERIFY-v1.5-phase-32.md, 37-VERIFY-v1.5-phase-33.md]
  modified: [.planning/milestones/v1.6-repo-split/CONTEXT.md]
completed: 2026-10-08
---

# Phase 37 Plan 01: Pre-promotion gate Summary

Read-only `verify-v15-promotion.mjs --pre` reads v1.5 markers from the git ref, requires a recorded 34/35 status and an audit record; exits 0 on the real repo with audit `gaps_accepted` (9 named gaps).

## What Shipped

- Task 1 (e479fae): verifier plus 9-case node:test suite with fixture repos and negative controls.
- 34/35 status section in CONTEXT.md (fad072a): both DEFERRED per D8 (MERGE-01).
- Task 2: `37-AUDIT-v1.5.md`, result `gaps_accepted`, owner Raj, audited_ref `1ecddd9f4a0e25b5f821c5969b89feb30b20f9e2`. Status was decided by the orchestrator from Raj's "hold until CI is confirmed green on 1ecddd9" instruction; Raj may override. Evidence: the two rrr-verifier reports (32: human_needed 13/13, 0 tests local; 33: human_needed 6/7, employers.internjobs.ai HTTP 200, email-worker 23/23) and CI on tip 1ecddd9 (push run 35924120109, all required jobs success; PR #26 head 468cc8e all 6 passed). A full /rrr:audit-milestone run was not performed; integration-checker pass is accepted gap 8.
- D9 (Raj's pre-approval of the promotion merge, tightly scoped) committed to CONTEXT.md.

## RED evidence (captured before GREEN)

1. Test suite with verifier missing (first executor, scratchpad/red.txt): `node --test` 6/9 failing, e.g.
   `Error: Cannot find module '.../scripts/verify-v15-promotion.mjs'` ... `1 !== 0` (the 3 passing cases were negative controls expecting exit 1).
2. Mutation checks (first executor): marker lookup switched to worktree made test 3 ("marker only in worktree") go red; restored.
3. Real-repo `--pre` before 34/35 status and audit recorded: FAIL lines for Phase 34, Phase 35 and audit missing.
4. This turn, real repo `--pre` before writing the audit (exit 1):
```
OK ref origin/integration/v1.5 = 1ecddd9f...
OK marker 32/33/36 valid
OK Phase 34 status deferred (confirmed by Raj on 2026-10-08)
OK Phase 35 status deferred (confirmed by Raj on 2026-10-08)
FAIL audit record missing: .../37-AUDIT-v1.5.md
EXIT 1
```

## GREEN evidence

`node scripts/verify-v15-promotion.mjs --pre --expect-head 1ecddd9f4a0e25b5f821c5969b89feb30b20f9e2`:
```
OK ref origin/integration/v1.5 = 1ecddd9f...
OK head matches expected 1ecddd9f...
OK marker 32 / 33 / 36 valid on origin/integration/v1.5
OK Phase 34 status deferred (confirmed by Raj on 2026-10-08)
OK Phase 35 status deferred (confirmed by Raj on 2026-10-08)
OK audit gaps_accepted (9 named)
OK ci.yml contains all required check names
EXIT 0
```
`node --test scripts/verify-v15-promotion.test.mjs`: tests 9, pass 9, fail 0.

## Deviations from Plan

None to code. Process note: the audit worktree was handled by the predecessor/orchestrator; the temporary detached worktree `scratchpad/v15-verify` was removed with `git worktree remove --force` and `git worktree list` confirms it is gone. The audit used rrr-verifier reports plus CI rather than a literal /rrr:audit-milestone run (disclosed in the audit file).

## Rulings

None - no plan conflicts arose.

## Next

Gate for plan 02: rrr-verifier must write `37-01-VERIFICATION.md` status passed. No change to main or integration/v1.5.
