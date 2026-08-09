---
phase: 33-startups-web-app-golive
plan: 02
subsystem: email-ingest
tags: [cloudflare-workers, email-routing, dispatch, regression-tests, ci]
requires:
  - "Phase 33-01 (apps/startup POST /internal/email/inbound) — the handoff target"
provides:
  - "employers.internjobs.ai dispatch branch in the zone-wide email catch-all Worker"
  - "First-ever test coverage for apps/email-worker (21 cases incl. regression suite for live-mail paths)"
  - "Exported EMPLOYERS_HANDOFF_TIMEOUT_MS / OVERHEAD_BUDGET_MS for Plan 33-04's cross-package CI invariant"
  - "email-worker CI job"
affects:
  - "Plan 33-04 (secret provisioning + scripts/check-email-timeout-invariant.mjs + deploy)"
  - "Plan 33-05 (live checkpoint: unknown-slug mail must arrive intact in the operator inbox)"
tech-stack:
  added: []
  patterns:
    - "Schema-agnostic HTTPS handoff: the email Worker dispatches raw MIME bytes rather than duplicating slug-resolution/parsing/DB logic"
    - "Fail-safe fallthrough: every handoff failure mode returns false (never throws) so the operator forward always runs"
key-files:
  created:
    - apps/email-worker/src/index.test.js
  modified:
    - apps/email-worker/src/index.js
    - apps/email-worker/wrangler.toml
    - apps/email-worker/package.json
    - .github/workflows/ci.yml
completed: 2026-07-14
---

# Phase 33 Plan 02: Email Worker Employers Dispatch Summary

Added an `@employers.internjobs.ai` dispatch branch to the zone-wide CF Email Routing catch-all Worker (raw-MIME HTTPS handoff to the startup Worker, fail-safe to the operator forward on every failure), and gave this previously-untested live-mail Worker its first regression suite.

## What Shipped

**1. The dispatch branch (`apps/email-worker/src/index.js`)**

`dispatchToEmployersHandoff(message, toAddress, fromAddress, env)` — exported — POSTs the exact raw MIME bytes (`ArrayBuffer`, not JSON) to `STARTUP_EMAIL_HANDOFF_URL` with `Authorization: Bearer <EMAIL_HANDOFF_SECRET>`, `Content-Type: message/rfc822`, `X-Startup-To`, `X-Startup-From`, bounded by `AbortSignal.timeout(20000)`. It returns `true` only on 2xx and **`false` (never throws) on every other outcome**: unconfigured binding, unreadable raw body, network error, timeout, or non-2xx — including the startup Worker's `404` for an unknown slug.

The branch sits **inside the existing `if (!conversationId)` block, immediately before the pre-existing generic operator forward**. On `false` it falls through to that untouched `message.forward(OPERATOR_FALLBACK)` + audit-ping block. The conv-alias path and the generic-forward path have **zero control-flow changes** — the only edit is one new conditional inserted ahead of the forward.

Fail-safe guarantee met: an unknown/unresolvable employers slug is forwarded to the operator, never silently dropped.

**2. Timeout contract honored exactly**

`OVERHEAD_BUDGET_MS = 5000` and `EMPLOYERS_HANDOFF_TIMEOUT_MS = 20000`, both `export const`, both carrying the full budget-breakdown comment. These are the values Plan 33-04's `scripts/check-email-timeout-invariant.mjs` will read to assert `RESOLVE(4000) + INSERT(5000) + OVERHEAD(5000) = 14000 <= HANDOFF(20000)`. Unchanged from the plan.

**3. First-ever test suite (`src/index.test.js`, 21 cases, ~500 lines)**

`node:test`, zero new deps, `globalThis.fetch` stubbed and restored in `finally` — no network.

The **regression half is the point** — this Worker carries ALL live inbound mail for the zone and had zero tests:
- conv-alias: HMAC-signed POST to `FLY_INGEST_URL`, `conversation_id` extraction (plain + bracketed + uppercase), non-2xx and network-error operator fallback, and **no diversion** to the handoff
- generic non-conv/apex forward, with the best-effort audit ping preserved
- near-miss conv alias (bad uuid) and apex `conv-*` (still correctly rejected)
- outer safety net: `email()` never throws even when internals throw and even when `forward()` itself throws (CF drops mail silently on an uncaught throw)

New-branch half: 200 success (no forward, correct headers, ArrayBuffer raw-MIME body), 404/500/network-error/timeout fail-safe forwards, unconfigured short-circuit with zero handoff fetches, bracketed + uppercase normalization, and a same-package timeout tripwire.

**4. `wrangler.toml` truth-fix + CI**

Replaced the stale routing comment (which asserted "This is the ONLY routing target" and "Apex mail NEVER reaches this Worker" — both false) with the CF-API-verified reality: one zone-wide catch-all, three dispatch branches, plus a note that specific-address rules bypass the Worker entirely. Added the `STARTUP_EMAIL_HANDOFF_URL` var and the `EMAIL_HANDOFF_SECRET` doc block. Added `"test": "node --test src/*.test.js"` and an `email-worker` CI job (appended at end-of-file, leaving room for 33-04's `email-timeout-invariant` job to append without collision).

## Verification

| Check | Result |
| --- | --- |
| `npm run check` (`node --check src/index.js`) | PASS |
| `npm test` (`node --test src/*.test.js`) | **21/21 pass, 0 fail** |
| Diff review: conv-alias / generic-forward / outer try-catch control flow | Unchanged (one conditional inserted) |
| Dispatch contract vs Plan 33-01 (URL, headers, body, status handling) | Matches |

**Mutation-tested the regression suite** to prove it isn't vacuous — each mutant was caught:

| Mutant | Tests failed |
| --- | --- |
| Dispatch success no longer short-circuits (spurious duplicate forward) | 3 |
| Employers suffix gate broadened to the whole zone (would divert conv-alias + apex mail) | 5 |
| Outer timeout shrunk 20000 -> 10000 | 1 |

Source was restored byte-identically afterward (`git diff --quiet` clean vs `d2804f5`).

## Deviations

**1. [Race — parallel execution] My Task-2 files were swept into a sibling plan's commit.**

I staged `index.test.js` + `package.json` + `ci.yml` and, in the window before my `git commit` ran, the parallel **33-01** agent ran a broad `git add`/`commit -a` in the shared working tree. Its commit `15e4701 test(33-01): cover both inbound-email entry points` therefore contains my three files alongside its own `apps/startup/workers/routes/email.test.ts`.

- **Content is correct and intact** — verified `git show HEAD:apps/email-worker/src/index.test.js` is byte-identical to my working copy; the CI job and `test` script are present in HEAD; the 33-02 dispatch code from `d2804f5` is untouched.
- **I did NOT rewrite history to fix attribution.** Sibling agents (33-01, 33-03) were actively committing on this branch; a `reset`/`rebase` to re-split the commit would have raced with them and could have destroyed in-flight work. Preserving their work outranked clean per-plan commit attribution.
- **Consequence:** 33-02's test/CI changes are not independently revertable from 33-01's. Task 1 (`d2804f5`) is unaffected and remains cleanly attributed to 33-02.

**2. [Assertion precision] "No fetch attempted" in the unconfigured case is asserted as "no *handoff* fetch attempted."**

The plan asked the unconfigured-guard test to assert that no fetch call was made at all. That is not literally achievable: on fallthrough, branch 3's **pre-existing** best-effort audit ping to `FLY_INGEST_URL` legitimately fires. The test asserts `callsTo(HANDOFF_URL).length === 0`, which is the actual invariant the guard exists to protect. Documented inline in the test.

**3. [Environment] No `STATE.md` exists in this repo** (`.planning/` is in team mode — `team-mode.json`, no `STATE.md` anywhere). No project-state update was made; creating one during parallel execution would have been out of scope and collision-prone.

## Notes for Later Plans

- **33-04:** `EMPLOYERS_HANDOFF_TIMEOUT_MS` (20000) and `OVERHEAD_BUDGET_MS` (5000) are `export const` in `apps/email-worker/src/index.js` and greppable via the plan's `pattern`. The `email-worker` CI job is the last job in `ci.yml` — append the `email-timeout-invariant` job after it. `EMAIL_HANDOFF_SECRET` still needs `wrangler secret put` on **both** Workers with the same value. **Nothing was deployed** — this plan is code-only, per instruction.
- **33-05 (live checkpoint):** the one thing unit tests structurally cannot cover — `dispatchToEmployersHandoff` drains `message.raw` via `arrayBuffer()` *before* a possible `message.forward()`. Mocks can't prove the real CF runtime still allows the forward after the stream is consumed. The live test (bogus employers slug -> mail must arrive **complete and intact** in `rentalaraj@gmail.com`) is what validates this ordering constraint. If it fails, the fix is to buffer raw bytes only after a successful suffix match and re-check forward semantics.
