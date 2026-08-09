---
phase: 36-lakera-failopen-quarantine
plan: "04"
subsystem: email-safety
tags: [testing, vitest, lakera, safety, quarantine, fail-open, trust-sender, mocked-fetch]

# Dependency graph
requires:
  - phase: 36-01
    provides: the quarantine branch (hard-block → Folders.SPAM), the per-employee isSenderTrusted() short-circuit, and the trust-sender / folder-counts routes — all of which this plan is the first coverage for
  - phase: 20 (SAFETY-01)
    provides: screenMessage() and its fail-open contract, previously untested
provides:
  - workers/tests/lib/safety.test.ts — 7 tests: missing-key / 5xx / network-throw / AbortError-timeout fail-open, flagged-true & flagged-false classification, plus a request-shape assertion
  - workers/tests/lib/inbound-email.test.ts — 7 tests: hard-block → SPAM (persisted, not dropped), fail-open → INBOX, trusted-sender skips Lakera, and paired negative cases
  - workers/tests/routes/inbox-actions.test.ts — extended with trust-sender + folder-counts smoke
  - Test-level evidence for LAKERA-VERIFY-LIVE-03 (no live API, no key rotation)
affects:
  - 36-02 spam UI (the trust-sender route it consumes now has smoke coverage)
  - 36-03 spam auto-purge cron (purgeExpiredSpam() remains uncovered — see Risks)
  - 36-05 (owns the documented decision on CI-wiring the Node-side screen.test.mjs)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "vi.stubGlobal('fetch') over the Node script's endpoint-captured-at-import-time approach (apps/app/src/safety/screen.test.mjs) — same scenario coverage, cleaner control, per 36-RESEARCH."
    - "Fully-mocked Env for receiveEmail: no DO runtime, no R2, no network. STUDENT_API_URL/SECRET deliberately left undefined so the safety_events ctx.waitUntil POST is skipped and the fetch spy counts ONLY Lakera calls — which is what the trusted-sender 'never called' assertion depends on."
    - "Mutation-verified assertions: each load-bearing test was proven to FAIL against a deliberately regressed copy of the source before being committed, so it is not a tautology that would pass against a broken implementation."
    - "Paired positive/negative cases (trusted vs not-trusted) prove the flag drives the branch, rather than an unconditional short-circuit producing a false pass."

key-files:
  created:
    - apps/parrot/workers/tests/lib/safety.test.ts
    - apps/parrot/workers/tests/lib/inbound-email.test.ts
  modified:
    - apps/parrot/workers/tests/routes/inbox-actions.test.ts

key-decisions:
  - "Tests were mutation-checked rather than trusted because they were green. Reverting `targetFolder = Folders.SPAM` to the pre-36-01 `return` failed 3 tests; breaking the trust short-circuit failed 1; breaking safety.ts's 5xx fail-open failed 1. This is the actual evidence that the suite is load-bearing."
  - "Added a request-shape assertion to safety.test.ts beyond the plan's 6 cases. With fetch fully stubbed, response-handling tests alone would still pass if the request itself regressed (wrong endpoint/auth/body). This closes that blind spot."
  - "No CI workflow file touched (locked 2026-07-16 decision). These tests run today via the existing parrot job's `npm test` — verified they are picked up by vitest.config.ts's `workers/tests/**/*.test.ts` include."
  - "No test rotates or invalidates a real Lakera key and none calls the live API (LAKERA-VERIFY-LIVE-03 satisfied at test level only, per the locked no-destructive-prod-test decision)."

completed: 2026-07-17
---

# Phase 36 Plan 04: Safety Test Coverage Summary

The two zero-coverage paths this phase's correctness rests on — `safety.ts`'s fail-open contract and `inbound-email.ts`'s rewritten hard-block branch — now have 14 direct unit tests, each mutation-verified to fail against a deliberately broken implementation.

## What Shipped

**Task 1 — `safety.test.ts`** (`1d990e3`) — 7 tests, first-ever coverage of `safety.ts`
- Fail-open: missing API key (and `fetch` provably never called), 5xx, network throw (with an explicit `threw === false` assertion against the "NEVER throws" contract), and `AbortError` → the `isTimeout` branch without a real 1s wait.
- Classification: `{ flagged: true }` → `action=flagged / score=1 / reason=lakera_flagged` — the exact contract `isHardBlock = screenResult.flagged === true` reads; `{ flagged: false }` → `passed / score=0 / reason=null`.
- Plus one case beyond the plan: asserts the outbound request really is a bearer-authed POST to `https://api.lakera.ai/v2/guard` with the v2 `{messages:[{role,content}]}` body.

**Task 2 — `inbound-email.test.ts`** (`d2ac36c`) — 7 tests, first-ever coverage of the branch 36-01 rewrote
- **Hard-block → quarantine:** `createEmail` called exactly once with `Folders.SPAM`, plus a second test asserting the full payload (subject/sender/body) is persisted — "persisted at all" is the anti-drop assertion, "persisted to SPAM" is the quarantine assertion, and "payload intact" is what makes it genuinely recoverable.
- **Fail-open → Inbox:** network throw, 5xx, and passed all land in `Folders.INBOX`. A Lakera outage neither stops mail nor mis-quarantines it.
- **Trusted sender:** `isSenderTrusted` called with the sender, `fetch` never called, mail to Inbox — plus the paired not-trusted case proving the flag is what drives the skip.

**Task 3 — `inbox-actions.test.ts`** (`1a78b4b`) — +2 smoke tests
- `POST /api/inbox/messages/:id/trust-sender` and `GET /api/inbox/folder-counts` (both confirmed mounted at `workers/index.ts:502` and `:387`) now have not-404/not-500 coverage in the file's existing auth-gate style. Grep confirmed no pre-existing `folder-counts` test, so both were added. The three existing assertions are untouched.

## Verification (actual observed output)

Run in `apps/parrot/`:

| Command | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test` | **93 passed** (18 files), exit 0 |
| `npm run build` | exit 0 |

**Baseline reconciled.** Measured the baseline before writing anything: **77 tests / 16 files**, exactly matching 36-01's finding and confirming the 122 figure is wrong (it belongs to another branch/suite). 77 + 7 + 7 + 2 = **93**, and 16 + 2 = 18 files. The arithmetic closes with no unexplained delta and no pre-existing test disturbed.

**Scope audit:** `git diff --name-only HEAD~3 HEAD` returns exactly the three files in the plan's `files_modified` — no drift. No `.github/**` or CI file touched. No production code touched (this plan is pure test authorship). The untracked `.planning/workstreams/team-workspace/PHASES-33-36-HANDOFF.md` was left unstaged.

## Mutation verification (why these tests are not tautologies)

Green tests against mocked `fetch` prove little on their own, so each load-bearing assertion was checked against a deliberately regressed copy of the source, then the source was restored (`git diff --stat` confirmed clean each time):

| Mutation | Result |
| --- | --- |
| `safety.ts`: 5xx returns `flagged:true` instead of failing open | **1 test failed** ✓ caught |
| `inbound-email.ts`: `targetFolder = Folders.SPAM` → `return` (the exact pre-36-01 silent drop) | **3 tests failed** ✓ caught |
| `inbound-email.ts`: `if (isTrusted) skipScreen = true` → `= false` | **1 test failed** ✓ caught |

The suite provably detects a regression to the silent-drop bug this phase exists to fix.

## Agreement with 36-01's implementation

**No disagreement found.** Every test passed against 36-01's code as written on the first run — no test needed bending to accommodate the implementation, and no implementation behavior contradicted the plan's stated contract. The runtime logs observed during the runs independently corroborate the branches firing: `lakera_screen_non2xx`, `lakera_network_error`, `lakera_timeout` from `safety.ts`, and `{"event":"lakera_hard_block_email",...,"hard_block":true}` from the quarantine branch. 36-01's quarantine path is no longer "verified by code reading alone."

## Deviations from Plan

**Additive test cases (beyond the plan's required list):**
- `safety.test.ts`: 7 cases instead of 6 — added the request-shape assertion (rationale in key-decisions).
- `inbound-email.test.ts`: 7 cases instead of 3 — added Lakera-5xx→Inbox, Lakera-passed→Inbox, full-payload-persisted, and the not-trusted negative pairing. All exercise the same branches the plan named; none required new fixtures.

**One typecheck-driven fix to the plan's suggested snippet:** the plan's `createEmail = vi.fn(async () => undefined)` produces a zero-arity spy, so `createEmail.mock.calls[0][1]` fails `npm run typecheck` (TS2493: tuple of length 0 has no element at index 1). Changed to a variadic `vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined)` and typed the `folderArg` helper off `ReturnType<typeof buildEnv>`. Caught only because typecheck runs over test files — `npm test` alone passed. The Task 2 commit was amended rather than fixed in a follow-up so it stands typecheck-clean and atomic.

No other files touched.

## Risks / Notes for Following Plans

1. **These are unit tests of branching logic, not of persistence.** The DO is fully mocked, so they prove `createEmail(Folders.SPAM, ...)` is *called* — not that `EmployeeMailboxDO` actually writes a row to the `spam` folder, nor that migration 10 applies cleanly on a real DO. 36-01's Risks 4 and 5 (migration self-apply, orphaned-R2-attachment self-heal) remain untested by construction. The orchestrator's live boot-check is still the first real signal for the storage layer.
2. **`purgeExpiredSpam()` still has zero coverage** — it is dead code until 36-03 wires the cron. Out of scope here; 36-03 should bring its own test.
3. **The workerd entrypoint trap is not exercised by any of this.** `workers/app.ts` must export only functions, and typecheck/vitest/`wrangler deploy` all pass a violation silently. Nothing in this plan touches `app.ts`, but note that a green suite is not evidence the Worker boots.
4. **`SYSTEM_FOLDER_IDS` in `shared/folders.ts` still excludes `spam`** (36-01's note 7 — re-confirmed by reading the file this plan). `Folders.SPAM` and its display name exist; the array omission is untouched and 36-02 should check its callers before adding the nav item.
5. **The Node-side `apps/app/src/safety/screen.test.mjs` remains un-CI-wired.** Explicitly out of scope per the plan; 36-05 owns that documented decision. The Worker-side coverage added here does not substitute for it — different runtime, different env injection.
