---
phase: 37-merge-v1.5
plan: 02
subsystem: release-gating
tags: [node-test, promotion, merge-commit]
provides: [verify-v15-promotion.mjs --gate-prev --preflight-checks --post, PR #28 merged to main]
key-files:
  created: []
  modified: [scripts/verify-v15-promotion.mjs, scripts/verify-v15-promotion.test.mjs, .planning/milestones/v1.6-repo-split/CONTEXT.md]
completed: 2026-10-08
---

# Phase 37 Plan 02: Promotion gate and merge Summary

Added `--gate-prev`, `--preflight-checks` and `--post` to the promotion verifier, then merged PR #28 (integration/v1.5 -> main) as merge commit 4c182d3 after Raj's explicit approval.

## What Shipped

- Tests (ffa111e) then implementation (12ac010) for the three new modes.
- `realpathSync` fix: used only in the main-module (entry-point) guard at the bottom of `scripts/verify-v15-promotion.mjs` (~line 270), comparing `realpathSync(process.argv[1])` to `realpathSync(fileURLToPath(import.meta.url))` so the CLI still runs when invoked through a symlinked path (macOS /var vs /private/var). It is not used for fixture-repo path comparisons.
- Live merge (done by the orchestrator, not the executor): Raj answered "Approve: merge #28 now" at the gate. PR #28 MERGED as merge commit `4c182d3` (parents 13b0a5e + 1ecddd9). `integration/v1.5` kept at 1ecddd9. Checks: 4 required SUCCESS + 2 extra email checks SUCCESS. Two verifier advisories (Phase 32/33 human_needed; audit gaps_accepted) were shown to Raj before approval. Recorded under D9 in CONTEXT.md.

## RED evidence (captured before GREEN)

1. Test suite before implementation (scratchpad red-37-02.txt): `tests 34, pass 9, fail 25`; e.g. `g4 gate: both present, status passed -> exit 0 ... 2 !== 0` and `t1 post GREEN: merge-commit promotion -> exit 0 ... usage: verify-v15-promotion.mjs --pre [options]` (exit 2, modes unknown). p7 failed as `0 !== 1`.
2. Live `--post` before the merge (first executor's report): exit 1, tip 1ecddd9 not an ancestor of main, markers absent on main. The raw output of that live run was not saved to the scratchpad file (the file holds the test-suite RED only), so it is cited from the report.

## GREEN evidence

`git fetch -q origin && node scripts/verify-v15-promotion.mjs --post --pr 28`, exit 0:

```
OK origin/integration/v1.5 (1ecddd9f4a0e25b5f821c5969b89feb30b20f9e2) is an ancestor of origin/main
OK marker 32 present on origin/main
OK marker 33 present on origin/main
OK marker 36 present on origin/main
OK PR base is main
OK PR head is integration/v1.5
OK PR is merged
OK check 'submission gate (rrr)' SUCCESS
OK check 'workspaces (marketing · app · employers)' SUCCESS
OK check 'workspace worker (parrot)' SUCCESS
OK check 'startups worker (typecheck · tests)' SUCCESS
INFO extra check email timeout invariant (cross-package): SUCCESS
INFO extra check email worker (tests): SUCCESS
```

Test suite GREEN at 12ac010 (per the first executor's run).

## Mutation checks (first executor)

Each mutation turned tests red and was restored: ancestor check, status:passed check, subset check (REQUIRED_CHECKS subset of ci.yml), equality-tightening (protection contexts equality), protection == constant.

## Deviations from Plan

None - the live merge was performed by the orchestrator after the human gate, as planned.

## Rulings

None - no plan conflicts arose.
