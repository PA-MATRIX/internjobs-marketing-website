---
phase: 36-lakera-failopen-quarantine
plan: "05"
subsystem: email-safety
tags: [lakera, ci, verification, hand-off, docs, account-gated]
status: partial — Task 1 complete, Task 2 awaiting Raj (checkpoint)

# Dependency graph
requires:
  - phase: 36-04
    provides: the Worker-side fail-open + hard-block tests that this doc accepts as the closing evidence for SAFETY-VERIFY-LIVE-03
  - phase: 22
    provides: infra/LAKERA-PRICING.md and the original 2026-05-24 deferral of VERIFY-LIVE-03 (destructive prod key rotation declined)
provides:
  - infra/LAKERA-PRICING.md — "CI wiring decision" section recording how SAFETY-VERIFY-LIVE-03 is satisfied + the accepted screen.test.mjs CI gap
  - infra/LAKERA-PRICING.md — dated, still-pending hand-off for the LAKERA-V2-03 tier/quota question (Raj)
---

# 36-05: Lakera tier hand-off + CI wiring decision

## What was done

**Task 1 (autonomous) — COMPLETE.** Recorded the CI-wiring decision in `infra/LAKERA-PRICING.md`:

- `SAFETY-VERIFY-LIVE-03` / `LAKERA-VERIFY-LIVE-03` is satisfied at **test level** by the Worker-side tests added in 36-04 (`workers/tests/lib/safety.test.ts`, `workers/tests/lib/inbound-email.test.ts`), which **do** run in CI via the existing parrot job's `npm test` (folded in by Phase 27 — no new CI wiring needed).
- Both runtimes (`apps/app/src/safety/screen.mjs`, `apps/parrot/workers/lib/safety.ts`) share an identical fail-open contract, so the Worker-side test is accepted as closing evidence.
- **Known, accepted gap:** `apps/app/src/safety/screen.test.mjs` exists and passes (5/5, ~1s; skips live-API assertions when `LAKERA_GUARD_API_KEY` is unset) but is **not wired into CI** — the `workspaces` job only runs `npm run build:app`. **Decision (Nithin, 2026-07-16): leave the shared CI workflow unchanged this phase.** Logged as a candidate follow-up, not a silent omission.

**Task 2 (human) — NOT ATTEMPTED, by design.** LAKERA-V2-03 (tier/quota confirmation) is account-gated to Raj. No tier, price, or quota was invented; the question is recorded in `infra/LAKERA-PRICING.md` as a dated, still-pending hand-off.

## Commits

- `c919705` docs(36-05): record SAFETY-VERIFY-LIVE-03 CI-wiring decision
- `97facf7` docs(36-05): record LAKERA-V2-03 tier question as dated still-pending hand-off

## Evidence cited (all actually observed during this phase)

- `apps/parrot` vitest suite grew 77 → 93 (36-04) → 106 (36-03). Final: **106 passed / 19 files**, typecheck + build exit 0.
- 36-04 mutation-verified the assertions: reverting the quarantine to the pre-36-01 `return` drop turned **3 tests red**; inverting the trust check turned **1 red**; making a Lakera 5xx return `flagged:true` (breaking fail-open) turned **1 red**.
- The stale "122 tests" baseline in earlier notes is wrong — it came from the Phase 32 branch, which carries its own tests. 77 is the correct `integration/v1.5` baseline (verified by stashing on a clean tree).

## Checkpoint — awaiting Raj

**What Raj must do:** sign in to `platform.lakera.ai` (Cisco AI Defense), capture the tier name + monthly quota / per-request price, and confirm whether the pilot's estimated ~30k requests/month fits that tier.

**Where it goes:** add a `**Decision: <tier> is sufficient / not**` line to `infra/LAKERA-PRICING.md`.

**Why no agent can do it:** dashboard-only, behind Raj's account. Fabricating the number would be worse than leaving it open.

## Deviations

The executing agent was terminated by an API error immediately after committing both tasks, before it wrote this SUMMARY. Both commits were verified present and the working tree verified clean; this SUMMARY was reconstructed by the orchestrator from the verified commit record. No code or doc content is affected.

## Constraints held

- No CI workflow file touched (that was the point of Task 1).
- No fabricated Lakera tier/pricing data.
- Files staged individually; untracked `PHASES-33-36-HANDOFF.md` left unstaged.
- Team mode: no root STATE/ROADMAP edits.
