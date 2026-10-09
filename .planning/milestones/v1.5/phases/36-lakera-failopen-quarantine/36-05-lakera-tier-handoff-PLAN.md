---
phase: 36-lakera-failopen-quarantine
plan: 05
type: execute
wave: 1
depends_on: []
files_modified:
  - infra/LAKERA-PRICING.md
autonomous: false
skills: []
skills_mode: normal

verification:
  surface: backend_only
  frontend_impact: false
  required_steps: []

must_haves:
  truths:
    - "Lakera pricing tier sufficiency for the ~30k/month pilot volume is either confirmed sufficient, confirmed insufficient (with a remediation note), or explicitly recorded as still-pending with a dated hand-off — not silently dropped"
    - "The CI-wiring status of both fail-open test suites (Worker-side, now covered by Plan 36-04; Node-side apps/app/src/safety/screen.test.mjs, pre-existing but NOT CI-wired) is explicitly documented as a deliberate 2026-07-16 decision, not left ambiguous or silently dropped"
  artifacts:
    - path: infra/LAKERA-PRICING.md
      provides: "a \"**Decision: <tier> is sufficient / not sufficient.**\" line appended to the existing \"Tier assessment\" section, once Raj responds"
    - path: infra/LAKERA-PRICING.md
      provides: "a \"CI wiring decision (SAFETY-VERIFY-LIVE-03 / LAKERA-VERIFY-LIVE-03)\" section recording the 2026-07-16 decision to leave .github/workflows/ci.yml unchanged this phase"
  key_links: []
---

<objective>
Close LAKERA-V2-03 (pricing tier / quota confirmation), the one remaining v1.4 carry-over that
is genuinely credential-gated to Raj's `platform.lakera.ai` dashboard access — no CLI/API
exposes tier or billing data, confirmed in `infra/LAKERA-PRICING.md`'s own "Tier assessment"
section (written 2026-05-24, still marked TBD).

Also records a separate, already-made decision (2026-07-16): the user declined wiring
`apps/app/src/safety/screen.test.mjs` into `.github/workflows/ci.yml` this phase. That gap
must be documented, not hidden — this plan's Task 1 writes that record; no CI file is touched.

Purpose: the tier confirmation is a hand-off, not an implementation task — the document
already contains every instruction Raj needs, this plan's checkpoint task just formally asks
and records the answer. The CI-decision documentation is a small, immediately-executable
autonomous task with no dependency on Raj.
Output: an appended "Decision" line in `infra/LAKERA-PRICING.md`'s "Tier assessment" section,
plus a new "CI wiring decision" section in the same file.
</objective>

<coverage>
Requirement coverage this plan touches (legend: ★★★ = fully addressed, ★★ = mostly,
★ = partial, [GAP] = not addressed):

  LAKERA-V2-03                                    [GAP — account-gated to Raj]   Task 2
    (checkpoint:human-action) opens the hand-off with the exact question + exact answer
    format already spelled out; genuinely cannot be closed by an agent. Closes only once Raj
    responds and the Decision line is appended.
  SAFETY-VERIFY-LIVE-03 / LAKERA-VERIFY-LIVE-03   ★★★ (closed by Plan 36-04)   Task 1 records
    the CI-wiring decision here so the evidence trail for this requirement is explicit, not
    silent — the requirement itself is satisfied by Plan 36-04's new Worker-side tests, not
    by this plan.
</coverage>

<execution_context>
@~/.claude/rrr/workflows/execute-plan.md
@~/.claude/rrr/templates/summary.md
</execution_context>

<context>
@.planning/milestones/v1.5/phases/36-lakera-failopen-quarantine/36-RESEARCH.md
@infra/LAKERA-PRICING.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Document the SAFETY-VERIFY-LIVE-03 CI-wiring decision (2026-07-16)</name>
  <files>infra/LAKERA-PRICING.md</files>
  <action>
Append a new `## CI wiring decision (SAFETY-VERIFY-LIVE-03 / LAKERA-VERIFY-LIVE-03)` section
to `infra/LAKERA-PRICING.md` (after the existing "Known issues" / "Next review" content).
Do NOT edit any `.github/workflows/*.yml` file as part of this task — that is explicitly out
of scope per the 2026-07-16 decision below; this task is documentation-only.

Write the section stating plainly:

- SAFETY-VERIFY-LIVE-03 / LAKERA-VERIFY-LIVE-03 is satisfied at test level by the new
  Worker-side tests added in Plan 36-04 (`apps/parrot/workers/tests/lib/safety.test.ts` +
  `apps/parrot/workers/tests/lib/inbound-email.test.ts`), which DO run in CI today via the
  existing parrot job's `npm test` step (the same job that already CI-enforces the Phase 27
  Vitest smoke tests) — no new CI wiring was needed for these.
- Both runtimes implement an identical fail-open contract: `apps/app/src/safety/screen.mjs`
  (Node/Fly, student SMS path) and `apps/parrot/workers/lib/safety.ts` (Worker, Workspace
  email path) both fail-open on missing key / non-2xx / unparseable body / timeout-or-network
  error, and both never throw. The Worker-side test suite is accepted as closing evidence for
  both surfaces on that basis.
- **Known, accepted gap:** `apps/app/src/safety/screen.test.mjs` exists and passes (5/5,
  ~1s, live-API cases self-skip when `LAKERA_GUARD_API_KEY` is unset) but is NOT wired into
  any CI workflow — confirmed no step in `.github/workflows/*.yml` runs
  `node --test apps/app/src/safety/screen.test.mjs`. **Decision (Nithin, 2026-07-16): leave
  CI unchanged this phase; do not add it.** Recorded here as a candidate follow-up, not
  silently dropped.
  </action>
  <verify>
`grep -n "CI wiring decision" infra/LAKERA-PRICING.md` finds the new section.
`git diff --stat` (or the equivalent check at execute-plan time) shows no `.github/workflows/*`
files touched by this task or anywhere else in this phase.
  </verify>
  <done>
`infra/LAKERA-PRICING.md` records the CI-wiring decision in full; no CI workflow file is
modified anywhere in this phase.
  </done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 2: Confirm Lakera pricing tier sufficiency for pilot volume</name>
  <what-built>
Nothing to build beyond Task 1's documentation. `infra/LAKERA-PRICING.md` already documents
(since 2026-05-24) the exact signal available server-side, the exact steps needed, and the
exact decision-line format to append once answered. No new doc scaffolding is needed for the
tier question — this is purely an account-access ask.
  </what-built>
  <how-to-verify>
Ask Raj to sign in to `platform.lakera.ai` (or the Cisco AI Defense dashboard if redirected —
Lakera was acquired by Cisco) and report back:

1. Tier name (Community / Pro / Cisco AI Defense Enterprise / other)
2. Monthly request quota, or per-request pricing if usage-based
3. Whether ~30,000 requests/month (the pilot volume estimate already documented in
   `infra/LAKERA-PRICING.md`'s "Pilot volume estimate" table — 15k student SMS + 15k employee
   email) fits inside the current tier's free allowance, or triggers paid usage

Once Raj responds, append one line to the "Tier assessment" section of
`infra/LAKERA-PRICING.md`, directly under the existing "**Action item:**" paragraph:

```
**Decision: <tier name> is sufficient / not sufficient.**
```

followed by one sentence citing what he reported (tier + quota number). If NOT sufficient,
add a short follow-up note on the upgrade path/cost — no code change is required in this phase
either way; LAKERA-V2-03 is a documentation/decision requirement, not an implementation one.
  </how-to-verify>
  <resume-signal>
Reply with Raj's dashboard findings (tier name + quota), or "still pending" if not yet
available. This phase's other four plans (36-01 through 36-04) do not depend on this one and
should not be blocked waiting for it.
  </resume-signal>
</task>

</tasks>

<verification>
`infra/LAKERA-PRICING.md`'s "Tier assessment" section contains a `**Decision:**` line (or the
plan is explicitly left open with a recorded "still pending" status if Raj has not yet
responded — do not silently close this out without one or the other). Separately,
`infra/LAKERA-PRICING.md`'s "CI wiring decision" section exists regardless of Raj's response
timing (Task 1 is autonomous and independent of Task 2). No `.github/workflows/*.yml` file is
touched anywhere in this phase.
</verification>

<success_criteria>
1. Raj has been asked, with the exact question and exact answer-format already spelled out.
2. `infra/LAKERA-PRICING.md` reflects either a confirmed tier decision or an explicit
   still-pending status — LAKERA-V2-03 is never silently dropped.
3. `infra/LAKERA-PRICING.md` records the 2026-07-16 CI-wiring decision (leave CI unchanged
   this phase) so the `screen.test.mjs`-not-in-CI gap is documented, not hidden.
4. No `.github/workflows/*.yml` file is added or modified.
</success_criteria>

<output>
After completion, create `.planning/milestones/v1.5/phases/36-lakera-failopen-quarantine/36-05-lakera-tier-handoff-SUMMARY.md`
</output>
