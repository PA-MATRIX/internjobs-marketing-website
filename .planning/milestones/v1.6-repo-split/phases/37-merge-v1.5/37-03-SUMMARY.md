---
plan: 37-03
phase: 37-merge-v1.5
requirements: [MERGE-04]
status: complete
completed: 2026-10-08
---

# 37-03 Summary — close v1.5, freeze, position records

## What was built
- `scripts/verify-v15-promotion.mjs`: new modes `--closure`, `--closure --final`, `--freeze` (+78 lines) with 14 new tests (c1–c7, f1–f2) in `scripts/verify-v15-promotion.test.mjs` (+102).
- Plain merge of `origin/main` (4c182d3) into the docs branch: commit `03a712e`, no conflicts; PROJECT.md and ROADMAP.md auto-merged and kept both the v1.5-closure and v1.6 content.
- v1.5 closed PARTIAL (32, 33, 36 delivered; 34/35 deferred per D8) in PROJECT.md, ROADMAP.md, MILESTONES.md, REQUIREMENTS.md (commit `16a434f`); freeze rule D10 (process-only: PA-MATRIX is on the free plan; check = only PR #27 open against main); `.planning/current-intent.json` created in the shape of Projecta-marketing-cms's file plus `updated_at`.
- 37-02 SUMMARY `realpathSync` wording corrected (`d19e644`).
- HUD file deliberately untouched: the project HUD record contains only the `subagent_budget` schema, no position fields.

## RED evidence (captured BEFORE the script change)
Saved as `37-03-RED-evidence.txt` in this directory (copied from the executor's scratchpad `red.txt`, 2026-10-08 20:22): **14 of the new tests fail** with the existing 34 passing, e.g. `not ok 35 - c1 closure pre-verification GREEN -> exit 0; --final -> exit 1`, `not ok 36 - c2a NEG PROJECT says Current Milestone v1.5`, `not ok 40 - c2e NEG a MERGE-0x lacks the pending marker`.
Live `--closure` RED before the record edits: exit 1 with 26 FAIL lines (PROJECT still showing v1.5 current, no v1.5 MILESTONES entry, MERGE-01..04 lacking the marker, ROADMAP Phase 37, STATE, missing current-intent.json). **Disclosure:** that live RED output was reported by the executor and was not saved as a file; it is cited, not re-run (the records have since been edited).
**Disclosure:** tests and implementation landed in one commit (`9483f0a`); the RED output was captured before the implementation but there is no separate RED commit.

## GREEN evidence (re-run by the orchestrator after the push, 2026-10-08)
- `node --test scripts/verify-v15-promotion.test.mjs`: 48 tests, 48 pass, 0 fail (exit 0).
- `node scripts/verify-v15-promotion.mjs --closure`: exit 0 (17 OK lines).
- `--closure --final`: exit 1, as intended (MERGE-01..04 are not yet Complete; the flip happens only after the phase verifier passes).
- `--freeze`: exit 0 (only PR #27 open against main); negative control (a `feature/x` PR fixture) exits 1.

## State
Phase 37 is complete (2026-10-08). `37-VERIFICATION.md` is `status: passed` (re-verified after conditions A/B closed). Task 4 flipped MERGE-01..04, ROADMAP Phase 37 and STATE to Complete under Raj's approval recorded as D11 in CONTEXT.md. PR #27 merge is a separate approved step (D11), executed by the orchestrator, not by this plan.

## Final GREEN (Task 4, after the flip, 2026-10-08)
Saved verbatim: `37-03-final-RED.txt` (before the flip: exit 1, MERGE-01..04 / ROADMAP / STATE FAILs) and `37-03-final-GREEN.txt` (after the flip: `--closure --final` exit 0, all 19 checks OK).
- `node scripts/verify-v15-promotion.mjs --closure --final`: exit 0.
- `node scripts/verify-v15-promotion.mjs --freeze`: exit 0 (only PR #27 open against main).
- `node --test scripts/verify-v15-promotion.test.mjs`: 48 tests, 48 pass, 0 fail.
- `node scripts/verify-v15-promotion.mjs --closure` (pre-verification mode): exit 1 by design. It asserts the "executed, pending verification" state that Task 4 removes, so it cannot pass after a correct flip. `--final` is the post-verification gate and supersedes it. Not changed in this task (would be a script/plan amendment).
