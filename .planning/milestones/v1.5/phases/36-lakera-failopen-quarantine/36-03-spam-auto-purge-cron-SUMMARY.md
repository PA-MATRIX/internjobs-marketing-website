---
phase: 36-lakera-failopen-quarantine
plan: "03"
subsystem: email-safety
tags: [spam, retention, cron, durable-objects, cloudflare-workers, kv, vitest]

# Dependency graph
requires:
  - phase: 36-01
    provides: EmployeeMailboxDO.purgeExpiredSpam(cutoffIso) — shipped defined-but-never-called; this plan is what makes it live
  - phase: 19
    provides: the existing scheduled() handler + the `*/5 * * * *` wrangler.jsonc cron trigger this sweep rides, and auto-clear.ts's fail-soft house style
  - phase: 10 Wave 1
    provides: WorkspaceDO.listEmployees() used for the per-employee fan-out
provides:
  - workers/lib/spam-purge.ts — runSpamPurge(env): ~24h KV throttle gate + per-employee fan-out to purgeExpiredSpam()
  - app.ts scheduled() now fires ctx.waitUntil(runSpamPurge(env)) alongside runAutoClear(env)
  - first automated coverage of the cron wiring itself (mutation-verified)
affects:
  - 36-04 safety test coverage (shares workers/tests/lib/; test baseline moves 93 → 106)
  - any future plan touching scheduled() — the wiring regression guard will fail loudly if runSpamPurge is dropped

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Throttle-on-an-existing-trigger: rather than adding a cron trigger per job, ride the shared */5 tick and gate internally on a KV last-run timestamp. Keeps wrangler.jsonc a single-trigger file as jobs accumulate."
    - "Fail-safe direction is a design axis, not an implementation detail: every unusable-gate path (KV absent, get() rejects, unparseable, future-dated, put() fails) falls through to sweeping. Only a confirmed-recent timestamp skips. An extra sweep is idempotent and near-free; a missed sweep silently defeats the retention policy forever."
    - "Constants live off the workerd entrypoint. RETENTION_DAYS/PURGE_INTERVAL_MS/LAST_RUN_KV_KEY sit in spam-purge.ts; app.ts only imports and calls, gaining no non-function top-level export."
    - "Wiring asserted by executing the real scheduled() export with a fake ctx, not by grepping for the call. Directly targets the dead-code failure mode 36-01 left behind."

key-files:
  created:
    - apps/parrot/workers/lib/spam-purge.ts
    - apps/parrot/workers/tests/lib/spam-purge.test.ts
  modified:
    - apps/parrot/workers/app.ts

key-decisions:
  - "30-day retention window honoured verbatim (locked user decision 2026-07-09) — RETENTION_DAYS = 30, asserted by a test that pins the cutoff to 29–31 days ago."
  - "No new wrangler.jsonc cron trigger. The existing `*/5 * * * *` entry is reused; wrangler.jsonc has an empty diff. Sweep throttled to ~24h so pilot-scale (~50 employee) DO fan-out isn't hammered 288x/day."
  - "Added an `elapsed >= 0` guard the plan's snippet lacked. Without it a future-dated last-run value (clock skew or a corrupt write) wedges the throttle permanently shut and spam never purges again — the exact never-purge mode the plan set out to avoid. Mutation-verified: removing the guard turns the clock-skew test red."
  - "Used direct typed stub calls (workspaceStub.listEmployees(), mailboxStub.purgeExpiredSpam()) instead of the plan's `as unknown as {...}` casts. The casts would have made typecheck rubber-stamp the RPC signatures; direct calls make the compiler actually verify them against WorkspaceDO/EmployeeMailboxDO. Typecheck passes, so the signatures are confirmed compatible."
  - "No backfill of previously-dropped mail (inherited 36-01 constraint) — nothing to backfill; it was never persisted."

completed: 2026-07-17
---

# Phase 36 Plan 03: Spam Auto-Purge Cron Summary

The 30-day spam retention decision is now real: `EmployeeMailboxDO.purgeExpiredSpam()` — which 36-01 shipped as deliberate dead code — is called once per ~24h from the existing `*/5 * * * *` Worker cron, fanning out one purge RPC per employee, fail-soft and with the throttle biased toward purging.

## What Shipped

**Task 1 — `runSpamPurge` orchestration module** (`a57fe08`)
- New `workers/lib/spam-purge.ts`, modelled on `auto-clear.ts`'s header/fail-soft/structured-logging style.
- Throttle gate on `PARROT_FEATURE_FLAGS` KV key `spam_purge_last_run` (distinct from the `safety_skip_senders` key the binding already holds).
- Per-employee `try/catch` fan-out; a `spam_purge_sweep_complete` summary log gives the operator one greppable line per sweep.
- `RETENTION_DAYS`/`PURGE_INTERVAL_MS`/`LAST_RUN_KV_KEY` live **here**, off the entrypoint, by design.

**Task 2 — cron wiring** (`3be20fe`)
- `import { runSpamPurge } from "./lib/spam-purge";` beside the existing auto-clear import.
- `scheduled()` now runs `ctx.waitUntil(runSpamPurge(env))` alongside `ctx.waitUntil(runAutoClear(env))` — independently waitUntil'd, so neither sweep can starve the other.
- `wrangler.jsonc` untouched.

**Task 3 — coverage** (`f592afb`)
- 13 tests in `workers/tests/lib/spam-purge.test.ts` using a hand-built fake `env` (chat-realtime.test.ts style — no real DO/SQLite harness exists in this repo, and the plan correctly said not to build one).
- Beyond the plan's three cases: 30-day cutoff pinning, throttle release after 24h, empty-workspace no-op, `listEmployees` failure, and a five-case **fail-safe** block.

## Verification (actual observed output)

Run in `apps/parrot/`:

| Command | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test` | **106 passed** (19 files), exit 0 |
| `npm run build` | exit 0 |

Baseline was **93 tests / 18 files** (confirmed by running the suite on the untouched tree before any edit — this matches the brief and re-confirms 36-01's finding that the "122" figure is wrong). 93 + 13 new = 106. No pre-existing test changed.

**Entrypoint-trap check (explicit).** `grep -nE "^export (const|let|var) " apps/parrot/workers/app.ts` returns **nothing** — before and after. The only top-level exports in `app.ts` are the two pre-existing DO class re-exports (`EmployeeMailboxDO`, `WorkspaceDO` — classes, i.e. functions, legal) and `export default`. This plan added an `import` and a call statement only; **no non-function top-level export was introduced**. Constants stayed in `spam-purge.ts`.

**No new cron trigger.** `git diff --stat apps/parrot/wrangler.jsonc` is empty; `triggers.crons` still reads exactly `["*/5 * * * *"]`.

**How I verified `purgeExpiredSpam()` is genuinely no longer dead code** — not by grep, but by mutation:
1. The wiring test imports the real `app.ts` default export and invokes `worker.scheduled({}, env, ctx)` with a fake `ctx` that collects `waitUntil` promises, then asserts the mocked `purgeExpiredSpam` spy was called once per employee. The call chain `scheduled() → runSpamPurge → EMPLOYEE_MAILBOX stub → purgeExpiredSpam` is therefore exercised end-to-end.
2. Deleting the `ctx.waitUntil(runSpamPurge(env))` line makes that test **fail** (`expected "spy" to be called 2 times, but got 0 times`). The guard is real, then the line was restored.

`app.ts` turned out to be importable under plain-node vitest despite `virtual:react-router/server-build`, because that import is lazy (`() => import(...)`) and never resolves at module load. Verified with a throwaway probe test, which was deleted.

**Fail-safe direction, mutation-verified.** Removing the `elapsed >= 0` guard makes the clock-skew test fail — proving the guard is load-bearing and not decoration.

## Deviations from Plan

**1. [Rule 2 — Missing Critical] Added `elapsed >= 0` to the throttle gate.**
- **Found during:** Task 1, while checking the plan's throttle against the brief's "throttle must fail in the SAFE direction" requirement.
- **Issue:** The plan's `if (Number.isFinite(elapsed) && elapsed < PURGE_INTERVAL_MS) return;` treats a *future-dated* `spam_purge_last_run` as "ran recently" — negative elapsed is finite and `< 24h`. A skewed clock or corrupt KV write would wedge the gate shut and spam would **never** purge, indefinitely. That is the worst failure mode this plan exists to prevent.
- **Fix:** Added `elapsed >= 0`. Future-dated values now fall through to a sweep. Covered by the clock-skew test and mutation-verified.
- **Files:** `workers/lib/spam-purge.ts`. **Commit:** `a57fe08`

**2. [Improvement] Direct typed stub calls instead of the plan's `as unknown as {...}` casts.**
- The plan cast both stubs to inline structural types. Since `Env` already types `WORKSPACE: DurableObjectNamespace<WorkspaceDO>` and `EMPLOYEE_MAILBOX: DurableObjectNamespace<EmployeeMailboxDO>`, the casts would have suppressed exactly the check worth having. Direct calls typecheck clean, which independently confirms `purgeExpiredSpam(cutoffIso) → {purged:number}` and `listEmployees() → EmployeeRecord[]` match this caller.
- **Files:** `workers/lib/spam-purge.ts`. **Commit:** `a57fe08`

**3. [Scope] 10 extra tests beyond the plan's 3.**
- The plan's three cases don't cover the wiring — the single most likely thing to silently regress, and the entire point of the plan. Added the `scheduled()` regression guard plus the fail-safe matrix and cutoff pinning.
- **Files:** `workers/tests/lib/spam-purge.test.ts`. **Commit:** `f592afb`

No files were touched outside the plan's declared `files_modified` (verified: `git diff --name-only a57fe08^..HEAD` lists exactly the three). No CI workflow file, no `wrangler.jsonc`, no root STATE/ROADMAP (team mode). The untracked `.planning/workstreams/team-workspace/PHASES-33-36-HANDOFF.md` was left unstaged.

## Risks / Notes for Following Plans

1. **Not deployed, and never booted on real workerd.** Per the brief, deploy + live boot-check are the orchestrator's. The entrypoint-trap grep above is a *static* check; only a real workerd boot proves instantiation. Nothing about the change should trip it (no new non-function export), but the check is still owed.
2. **The purge is proven against mocks, not a real DO.** Tests assert `runSpamPurge` calls `purgeExpiredSpam` with a correct cutoff; they cannot prove the SQL (`WHERE folder_id = 'spam' AND date < ?`) deletes the right rows — that method still has no direct coverage, and 36-01 flagged the same gap for the quarantine write path. Note the cutoff compares against the `date` column (the email's own date header), **not** a quarantined-at timestamp: mail that arrives already bearing a >30-day-old `date` is eligible for purge on the very first sweep. That follows 36-01's method as shipped and was not changed here, but it is a real semantic worth an explicit decision if backdated spam matters.
3. **First sweep after deploy runs on the next tick** (≤5 min) since the KV key won't exist yet, and will purge the full existing backlog at once. Expected and desired, but it means the first sweep is the largest one.
4. **`purgeExpiredSpam()` still doesn't reap R2 attachment blobs** (36-01 note 6, pre-existing Trash limitation). Purging spam rows will therefore steadily orphan R2 objects. Not introduced here, not in scope, but auto-purge now makes it a *recurring* leak rather than an occasional one — worth a future plan.
5. **Throttle is best-effort, not a lock.** Two overlapping cron ticks could both pass the gate before either writes the stamp. Harmless (purges are idempotent deletes), and not worth a DO-backed lock at pilot scale.
