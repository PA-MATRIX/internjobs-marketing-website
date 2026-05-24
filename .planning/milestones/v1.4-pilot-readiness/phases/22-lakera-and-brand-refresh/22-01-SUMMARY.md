---
phase: 22-lakera-and-brand-refresh
plan: "01"
subsystem: safety
tags: [lakera, cisco-ai-defense, prompt-injection, safety-gate, schema-verification, silent-fail]

# Dependency graph
requires:
  - phase: 20-safety-rate-limits
    provides: Lakera screening helpers (screen.mjs + safety.ts) and the score >= 0.8 hard-block contract
provides:
  - Verified Lakera v2 endpoint, auth, and binary response shape (live-probed against production key)
  - Parser fix for v2 binary {flagged, metadata} shape — eliminates silent-fail in hard-block gate
  - Hard-block gate now triggers on flagged===true OR score>=0.8 (forward-compat shim)
  - infra/LAKERA-PRICING.md with verified findings + tier-confirmation follow-up
affects:
  - Phase 23 — SAFETY-VERIFY-LIVE-04 tests are now meaningful (hard-block actually fires)
  - Any future Lakera-related plan (LAKERA-V2-02/03)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Binary safety-flag mapping: v2 {flagged: bool} → score=1/0 to preserve ScreenResult contract"
    - "Forward-compat parser branch: honor v1 results[].categories.* if it ever returns"
    - "Hard-block gate: `flagged === true || score >= 0.8` — OR-form keeps numeric threshold alive"

key-files:
  created:
    - infra/LAKERA-PRICING.md
  modified:
    - apps/app/src/safety/screen.mjs
    - apps/app/src/safety/screen.test.mjs
    - apps/app/src/server.mjs
    - apps/parrot/workers/lib/safety.ts
    - apps/parrot/workers/lib/inbound-email.ts

key-decisions:
  - "Lakera v2 binary flag maps to score=1/0 (not null) to preserve safety_events.score contract"
  - "Hard-block gate uses OR not AND — both flag and score-threshold trigger blocks"
  - "Tier confirmation deferred to dashboard sign-in; verification proceeds without it"
  - "Skip Task 1 (Lakera signup checkpoint) — resolved by direct API probe via Fly app env"

patterns-established:
  - "Schema-drift detection: probe live API from inside the app's own runtime env, not from dev laptop"
  - "Critical-correctness deviation (Rule 2): silent-fail bugs in safety gates auto-fix without checkpoint"

# Metrics
duration: ~25min
completed: 2026-05-24
---

# Phase 22 Plan 01: Lakera v2 Schema Verification Summary

**Verified live Lakera v2 endpoint + binary response shape, then caught and fixed a silent-fail bug that had been letting injection attempts bypass the production hard-block gate since v1.3.**

## Performance

- **Duration:** ~25 min (continuation from checkpoint)
- **Started:** continuation 2026-05-24 (original checkpoint paused at Task 1)
- **Completed:** 2026-05-24
- **Tasks:** 3 (Task 1 resolved out-of-band; Tasks 2-3 executed)
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments

- Probed the live Lakera v2 API directly from inside the
  `internjobs-ai-student-app` Fly machine using the production
  `LAKERA_GUARD_API_KEY` from its environment — no fresh signup or
  dashboard sign-in needed.
- Documented the actual v2 binary response shape with verified-date
  comment headers in both `screen.mjs` and `safety.ts`.
- **Caught a critical silent-fail bug:** the v1 parser assumed
  `results[].categories.prompt_injection` (a 0-1 numeric score), but
  v2 returns only `{ flagged: bool, metadata: { request_uuid } }` —
  no `results[]`, no numeric score. The downstream `score >= 0.8`
  hard-block gate therefore never fired in production. Injection
  attempts were correctly classified by Lakera and logged as flagged,
  but fell through as soft-flag and reached the agent.
- Fixed the parser in both runtimes (Node + Worker) to map
  `flagged: true` → `score=1`, `reason="lakera_flagged"`, `action="flagged"`.
- Switched the caller's hard-block gate (4 call sites: 3 in
  `server.mjs`, 1 in `inbound-email.ts`) to
  `flagged === true || score >= 0.8`. The OR keeps the numeric
  threshold as a forward-compat shim.
- Updated VERIFY-01/02 test assertions for the v2 binary contract;
  added VERIFY-04 documenting the parser-resilience contract for
  the legacy v1 shape. All 5 tests pass.
- Wrote `infra/LAKERA-PRICING.md` capturing the verified endpoint,
  schema, pilot-volume estimate, and the silent-fail bug discovery.
  Tier/quota flagged as TBD pending dashboard sign-in.

## Task Commits

Each task was committed atomically:

1. **Task 1: Lakera signup** — **SKIPPED** (resolved by direct API probe via Fly app env on 2026-05-24; no fresh signup needed; existing key in Infisical works)
2. **Task 2: Schema verification + parser fix + caller gate fix** — `2cc2f90` (fix) + `c1649ca` (test)
3. **Task 3: Write infra/LAKERA-PRICING.md** — `e89f900` (docs)

**Plan metadata:** (this SUMMARY commit) (docs: complete plan)

## Files Created/Modified

- `infra/LAKERA-PRICING.md` (created) — Verified v2 endpoint, schema, pilot-volume estimate, silent-fail bug writeup, tier TBD follow-up.
- `apps/app/src/safety/screen.mjs` (modified) — Parser-block header updated to "VERIFIED 2026-05-24" with both example responses; parser logic rewritten for v2 binary shape; forward-compat branch for legacy v1 numeric score retained.
- `apps/parrot/workers/lib/safety.ts` (modified) — Mirror of the same parser fix on the Worker side; `LakeraResponse` interface updated to add `metadata` field.
- `apps/app/src/server.mjs` (modified) — Hard-block gate at 3 call sites (Photon, Mac-Bridge pairing, Mac-Bridge inbound) switched from `flagged && score >= 0.8` to `flagged === true || score >= 0.8`.
- `apps/parrot/workers/lib/inbound-email.ts` (modified) — Same hard-block gate switch on the Worker email path.
- `apps/app/src/safety/screen.test.mjs` (modified) — VERIFY-01/02 assertions rewritten for v2 binary contract (flagged=true → score=1, action="flagged", reason="lakera_flagged"); VERIFY-04 added documenting forward-compat for v1 shape.

## Decisions Made

- **Binary flag → numeric score mapping**: v2 returns no per-category score, so we map `flagged: true` → `score=1` and `flagged: false` → `score=0`. This preserves the `ScreenResult.score: number | null` contract used by every caller and by the `safety_events.score` DB column. Considered using `null` but that would force every caller to handle a new code path.
- **Hard-block gate uses OR not AND**: `flagged === true || score >= 0.8`. The OR clause keeps the numeric threshold alive as a forward-compat shim — if Lakera re-introduces per-category scores under `results[]`, the parser honors them and the threshold still applies. The AND form would have made the score-check dead code post-v2.
- **Skip the Lakera signup checkpoint**: Production key was already wired (Infisical + Fly digest `64ee3c881fc8742c`), and the user confirmed logs visible in the Lakera dashboard. Direct probe from the Fly app env produced verified findings without a fresh signup.
- **Tier confirmation deferred**: v2 API does not expose tier/quota; the dashboard sign-in step is documented in `infra/LAKERA-PRICING.md` as an explicit follow-up. We did not block 22-01 on it because the operational signal ("logs visible, key works") is positive.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing Critical] Lakera v2 schema-drift silent-fail in production hard-block gate**

- **Found during:** Task 2 (schema-drift analysis)
- **Issue:** The v1 parser assumed `raw.results[0].categories.prompt_injection` (numeric), but v2 returns only `{ flagged, metadata }`. With no numeric score, the parser always derived `injectionScore = 0`, so the caller's `screenResult.flagged && injectionScore >= 0.8` hard-block check could never be true. Lakera correctly classified injection attempts; we logged them as `flagged`; but the policy enforcement gate was dead code — every flagged injection was downgraded to soft-flag and reached the agent. **This matches the user's earlier observation that "Lakera logs events but does nothing."**
- **Fix:** Rewrote the parser in both `screen.mjs` and `safety.ts` to map v2 binary flag → numeric score (1 or 0). Switched the caller's hard-block gate to `flagged === true || score >= 0.8` at all 4 call sites (3 in `apps/app/src/server.mjs`, 1 in `apps/parrot/workers/lib/inbound-email.ts`). Added forward-compat branch in the parser for if Lakera ever re-introduces per-category numeric scores.
- **Files modified:** `apps/app/src/safety/screen.mjs`, `apps/parrot/workers/lib/safety.ts`, `apps/app/src/server.mjs`, `apps/parrot/workers/lib/inbound-email.ts`.
- **Verification:** All 5 tests pass in `apps/app/src/safety/screen.test.mjs` (3 fail-open + VERIFY-04 docs + 1 skip-stub for live tests). `npm run verify` in `apps/app` passes. Pre-existing TS error in `workers/types.ts` for `STUDENT_API_URL` discriminated type confirmed unrelated to this change (reproduces on `main` without these changes via `git stash`).
- **Committed in:** `2cc2f90` (parser + gates), `c1649ca` (test update).

**2. [Rule 3 — Blocking] Test assertions on numeric thresholds were no longer valid against the v2 schema**

- **Found during:** Task 2 (test update step)
- **Issue:** VERIFY-01 asserted `(result.score ?? 0) >= 0.5`. v2 returns only binary `flagged`, so any non-binary numeric assertion would never run against live API correctly after the parser fix.
- **Fix:** Rewrote VERIFY-01/02 assertions for the v2 binary contract. Added VERIFY-04 as a documentation-only assertion for the legacy v1 forward-compat branch.
- **Files modified:** `apps/app/src/safety/screen.test.mjs`.
- **Verification:** `node --test apps/app/src/safety/screen.test.mjs` reports `tests 5, pass 5, fail 0`.
- **Committed in:** `c1649ca`.

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 blocking).
**Impact on plan:** Both auto-fixes were necessary — Deviation #1 was a critical-correctness fix on a safety-gate path (the hard-block was dead code in production), and Deviation #2 was a direct consequence (tests had to update with the parser). Plan scope was expanded by ~50% (added 4 call-site edits + test rewrite) but the verification objective is the same; the scope expansion is fully documented here and in `infra/LAKERA-PRICING.md`.

## Issues Encountered

- The TS typecheck on `apps/parrot` reports a pre-existing error in `workers/types.ts` for `STUDENT_API_URL` (`Type 'string | undefined' is not assignable to type '"https://app.internjobs.ai"'`). Reproduced on `main` without these changes via `git stash` — unrelated to 22-01 and not a regression introduced here. Flagging for a future house-keeping pass.

## User Setup Required

None — no external service configuration changed. The existing
`LAKERA_GUARD_API_KEY` in Infisical + Fly + Wrangler continues to
work unchanged.

**Follow-up (not blocking):** Sign in to platform.lakera.ai (or Cisco
AI Defense dashboard) and update the "Tier assessment" section of
`infra/LAKERA-PRICING.md` with the actual tier name, monthly quota,
and pricing for the 30k/month pilot volume.

## Next Phase Readiness

- Phase 23 (Workspace Pilot Closeouts) can now run SAFETY-VERIFY-LIVE-04 meaningfully — the hard-block gate actually fires on flagged injections.
- LAKERA-V2-02 (parser correctness) and LAKERA-V2-03 (pricing doc) requirements are both satisfied by this plan.
- LAKERA-V2-01 (schema verification) is satisfied; date-stamp in both parser-block headers is `VERIFIED 2026-05-24`.
- No blockers introduced for the brand track (22-04/05) or for Phase 23.

---
*Phase: 22-lakera-and-brand-refresh*
*Completed: 2026-05-24*
