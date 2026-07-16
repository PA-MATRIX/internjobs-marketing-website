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
  artifacts:
    - path: infra/LAKERA-PRICING.md
      provides: "a \"**Decision: <tier> is sufficient / not sufficient.**\" line appended to the existing \"Tier assessment\" section, once Raj responds"
  key_links: []
---

<objective>
Close LAKERA-V2-03 (pricing tier / quota confirmation), the one remaining v1.4 carry-over that
is genuinely credential-gated to Raj's `platform.lakera.ai` dashboard access — no CLI/API
exposes tier or billing data, confirmed in `infra/LAKERA-PRICING.md`'s own "Tier assessment"
section (written 2026-05-24, still marked TBD).

Purpose: this is a hand-off, not an implementation task. The document already contains every
instruction Raj needs; this plan's only job is to formally ask and, once answered, record the
answer in the format the doc already specifies.
Output: an appended "Decision" line in `infra/LAKERA-PRICING.md`'s "Tier assessment" section.
</objective>

<execution_context>
@~/.claude/rrr/workflows/execute-plan.md
@~/.claude/rrr/templates/summary.md
</execution_context>

<context>
@.planning/milestones/v1.5/phases/36-lakera-failopen-quarantine/36-RESEARCH.md
@infra/LAKERA-PRICING.md
</context>

<tasks>

<task type="checkpoint:human-action" gate="blocking">
  <name>Confirm Lakera pricing tier sufficiency for pilot volume</name>
  <what-built>
Nothing to build. `infra/LAKERA-PRICING.md` already documents (since 2026-05-24) the exact
signal available server-side, the exact steps needed, and the exact decision-line format to
append once answered. No new doc scaffolding is needed — this is purely an account-access ask.
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
responded — do not silently close this out without one or the other).
</verification>

<success_criteria>
1. Raj has been asked, with the exact question and exact answer-format already spelled out.
2. `infra/LAKERA-PRICING.md` reflects either a confirmed decision or an explicit
   still-pending status — LAKERA-V2-03 is never silently dropped.
</success_criteria>

<output>
After completion, create `.planning/milestones/v1.5/phases/36-lakera-failopen-quarantine/36-05-lakera-tier-handoff-SUMMARY.md`
</output>
