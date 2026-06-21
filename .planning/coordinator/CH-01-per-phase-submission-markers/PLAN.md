# Coordinator Hardening CH-01: Per-Phase Submission Markers

> **Status:** planned → executing
> **Type:** coordinator infra (RRR submission-gate hardening) — *not* a team-owned product phase
> **Lands on:** `main` directly via coordinator PR (branch `ci/per-phase-submission-markers`), **before `integration/v1.5` is cut**
> **Owner:** coordinator (Raj / team-cms)
> **Milestone:** pre-v1.5 (outside the v1.x integer-phase sequence so it can't collide with phase numbers the v1.5 milestone will assign)
> **Created:** 2026-06-20

## Goal

Replace the single **rolling** `.planning/workstreams/<team>/SUBMISSION.json` — which `/rrr:submit-phase` (`manager.js:submitPhase`) rewrites *wholesale* and *accumulates* into every phase — with **per-phase** marker files `.planning/workstreams/<team>/submissions/<phase>.json`, so two concurrent phase branches can never merge-conflict on the submission marker again.

## Problem (why this phase exists)

`submitPhase()` does `completed.add(phase)` against the existing file and writes one path (`ctx.submissionPath` = `SUBMISSION.json`). Two consequences:

1. **Collision.** Each of a team's in-flight phase branches carries its own rewritten `SUBMISSION.json` → they conflict on merge. Discovered merging the v1.4 tail: **PR #12 (phase-26) vs PR #13 (phase-30) conflicted ONLY on `SUBMISSION.json`** — the code (`reply-forward.ts`, `durableObject/index.ts`) auto-merged clean. Same class as the STATE.md rolling-state conflict (already retired via `.gitignore`, lines 21–23).
2. **Conflation.** The accumulated file mixes phases: at v1.4 close it read `branch: rrr/v1.4/team-workspace-30` with `phases_completed: ["23","30"]` — one file claiming two phases on one branch's SHA.

The submission **gate** (`scripts/check-submission.mjs`, the enforced CI check) currently reads that rolling file (line 63). So the fix has a **consumer** side (the gate) and a **producer** side.

## Design

**Consumer (gate) — repo-owned, durable.** `check-submission.mjs` resolves the marker as: prefer `submissions/<branchPhase>.json`; fall back to the legacy `SUBMISSION.json` when no per-phase file exists. All existing validations unchanged (`ready_for_integration`, branch match, phase ∈ `phases_completed`, `head_sha` ancestor of tip). The fallback keeps any pre-existing branch valid during the transition.

**Producer — repo-owned, durable, no global dependency.** New `scripts/submit-phase.mjs` writes a single-phase `submissions/<phase>.json` from git state (`branch`, `merge-base` base_sha, `HEAD` head_sha, three-dot `files_touched`) + `.planning/team-mode.json` (github_team, milestone, expected branch). Schema-compatible with `manager.js`, plus an explicit `"phase"` field. **Self-contained so it survives `/rrr:update`** (which would clobber any edit to the global `~/.claude/commands/rrr/submit-phase.md` or `~/.claude/rrr/lib/team-mode/manager.js` — those are intentionally NOT touched).

**Retire the rolling file** (mirrors the STATE.md decision the user already endorsed). `git rm --cached` the tracked `SUBMISSION.json` and add `.planning/workstreams/*/SUBMISSION.json` to `.gitignore`. `/rrr:submit-phase` may still write it locally for RRR's own (advisory, report-first) `coordinate-merge` / `integration-report`; it's simply no longer the tracked, enforced source of truth. The gate's legacy fallback remains as a belt-and-suspenders for any working-tree-local copy.

## Why not edit the global RRR producer?

`/rrr:submit-phase` → `~/.claude/rrr/scripts/rrr-team-mode.js submit` → `manager.js:submitPhase` are **global** (`~/.claude/...`), shared across every repo, and overwritten by `/rrr:update`. A repo-owned `scripts/submit-phase.mjs` + repo-owned gate is the only durable seam. (`submit-phase.md` even documents a "development source repo fallback" `node scripts/rrr-team-mode.js submit` — same spirit.)

## Tasks

- [ ] **CH-01-1 — Gate reads per-phase, falls back to legacy.** `resolveSubmissionPath(repoRoot, team, branchPhase)` in `check-submission.mjs`; log which marker was used. Keep all current checks.
- [ ] **CH-01-2 — Repo producer `scripts/submit-phase.mjs`.** Writes `submissions/<phase>.json` from git + team-mode.json. `--team --phase [--ready] [--tests a,b] [--base <ref>]`. Refuses to mark ready without `--ready`.
- [ ] **CH-01-3 — Migrate history + retire rolling file.** Split the accumulated marker into `submissions/23.json` + `submissions/30.json`; `git rm --cached SUBMISSION.json`; add gitignore line beside the STATE.md block.
- [ ] **CH-01-4 — Docs.** `TEAM-WORKFLOW.md` submit section + day-to-day example use `submit-phase.mjs` and per-phase markers; note `/rrr:submit-phase` is now optional/advisory.

## Verification (goal-backward)

1. `submit-phase.mjs --team team-workspace --phase 31 --ready` on a `rrr/v1.5/team-workspace-31` branch writes `submissions/31.json` with that branch + `phases_completed:["31"]`.
2. Gate **passes** for that branch+phase against the per-phase file.
3. Gate **falls back** and passes when only legacy `SUBMISSION.json` is present (simulate by temp-removing per-phase file).
4. Gate **fails** when neither marker exists / `ready_for_integration:false` / branch mismatch / stale `head_sha`.
5. Two simulated concurrent per-phase files (`submissions/26.json` + `submissions/30.json`) merge with **zero conflict** (distinct paths).
6. This PR's own branch (`ci/per-phase-submission-markers`, non-team) → gate reports **N/A** (no chicken-and-egg).

## Rollback

Pure tooling/planning change; no app code. Revert the PR. The legacy fallback means even a partial revert leaves the gate functional on the rolling file.
